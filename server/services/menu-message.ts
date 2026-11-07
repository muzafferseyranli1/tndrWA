import type { Brand, PrismaClient } from "@prisma/client";
import { availabilityOf, type ProductStatus } from "../../shared/availability";
import { logger } from "../lib/logger";
import { getCatalogThumbnail } from "./catalog-thumb";
import { CloudApiError, type WhatsappCloudClient } from "./whatsapp-cloud";

/**
 * Müşteriye giden menü mesajı (karşılama, panelden "Katalog gönder"):
 * - "catalog": "Kataloğu görüntüle" düğmesi (WhatsApp katalog ekranı; sıralama ve kategoriler Meta'nın elinde).
 * - "list": kategorili ürün listesi; bölümler ve ürünler paneldeki sırayla görünür. Sığmazsa ya da Meta reddederse katalog düğmesi gider.
 */
export type MenuMode = "catalog" | "list";
export const MENU_MODES: MenuMode[] = ["catalog", "list"];
export const LIST_MAX_SECTIONS = 10;
export const LIST_MAX_ITEMS = 30;
const SECTION_TITLE_MAX = 24;
const HEADER_MAX = 60;

const modeKey = (brandCode: string) => `catalog.mode.${brandCode}`;

export async function getMenuMode(db: PrismaClient, brandCode: string): Promise<MenuMode> {
  const row = await db.setting.findUnique({ where: { key: modeKey(brandCode) } });
  return row?.value === "list" ? "list" : "catalog";
}

export async function setMenuMode(db: PrismaClient, brandCode: string, mode: MenuMode): Promise<void> {
  if (mode === "catalog") {
    await db.setting.deleteMany({ where: { key: modeKey(brandCode) } });
    return;
  }
  await db.setting.upsert({ where: { key: modeKey(brandCode) }, create: { key: modeKey(brandCode), value: mode }, update: { value: mode } });
}

export interface MenuListPlan {
  sections: { title: string; retailerIds: string[] }[];
  items: number;
  /** Gönderilebilir mi; değilse nedeni `reason`da */
  fits: boolean;
  reason: string | null;
}

interface PlanCategory {
  id: number;
  name: string;
}
interface PlanProduct {
  retailerId: string;
  categoryId: number | null;
  status: ProductStatus;
  soldOutUntil: Date | null;
  onMeta: boolean;
}

const sectionTitle = (name: string) => (name.length > SECTION_TITLE_MAX ? `${name.slice(0, SECTION_TITLE_MAX - 1).trimEnd()}…` : name);

/** Sıralı kategoriler + sıralı ürünlerden liste bölümleri: yalnız katalogda olan ve şu an sipariş verilebilen ürünler, boş kategoriler atlanır. */
export function planMenuList(categories: PlanCategory[], products: PlanProduct[], now: Date = new Date()): MenuListPlan {
  const usable = products.filter((p) => p.onMeta && availabilityOf(p, now) === "IN_STOCK");
  const sections: MenuListPlan["sections"] = [];
  for (const c of categories) {
    const ids = usable.filter((p) => p.categoryId === c.id).map((p) => p.retailerId);
    if (ids.length) sections.push({ title: sectionTitle(c.name), retailerIds: ids });
  }
  const known = new Set(categories.map((c) => c.id));
  const rest = usable.filter((p) => p.categoryId === null || !known.has(p.categoryId)).map((p) => p.retailerId);
  if (rest.length) sections.push({ title: "Diğer", retailerIds: rest });

  const items = sections.reduce((n, s) => n + s.retailerIds.length, 0);
  const reason =
    items === 0
      ? "Katalogda gösterilecek ürün yok."
      : sections.length > LIST_MAX_SECTIONS
        ? `${sections.length} kategori var; listede en fazla ${LIST_MAX_SECTIONS} olabilir.`
        : items > LIST_MAX_ITEMS
          ? `${items} ürün var; listede en fazla ${LIST_MAX_ITEMS} olabilir.`
          : null;
  return { sections, items, fits: reason === null, reason };
}

export async function buildMenuList(db: PrismaClient, brandId: number, now: Date = new Date()): Promise<MenuListPlan> {
  const [categories, products] = await Promise.all([
    db.category.findMany({ where: { brandId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    db.product.findMany({ where: { brandId, status: "ACTIVE", onMeta: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { retailerId: true, categoryId: true, status: true, soldOutUntil: true, onMeta: true } }),
  ]);
  return planMenuList(categories, products as PlanProduct[], now);
}

/** Markanın ayarına göre menü mesajını gönderir; mesaj kimliğini döndürür. Liste gönderilemezse katalog düğmesine düşer. */
export async function sendMenu(db: PrismaClient, cloud: WhatsappCloudClient, brand: Brand, to: string, text: string): Promise<string | null> {
  if (!brand.waPhoneNumberId) throw new CloudApiError(`${brand.name} için Cloud API telefon numarası kimliği girilmemiş.`);
  if (brand.metaCatalogId && (await getMenuMode(db, brand.code)) === "list") {
    const plan = await buildMenuList(db, brand.id);
    if (plan.fits) {
      try {
        return await cloud.sendProductList(brand.waPhoneNumberId, to, { catalogId: brand.metaCatalogId, header: `${brand.name} Menü`.slice(0, HEADER_MAX), body: text, sections: plan.sections });
      } catch (err) {
        if (!(err instanceof CloudApiError)) throw err;
        logger.warn({ code: err.code, err: err.message, brand: brand.code }, "Ürün listesi gönderilemedi, katalog düğmesi gönderiliyor");
      }
    } else {
      logger.warn({ brand: brand.code, reason: plan.reason }, "Ürün listesi sığmıyor, katalog düğmesi gönderiliyor");
    }
  }
  return cloud.sendCatalog(brand.waPhoneNumberId, to, text, await getCatalogThumbnail(db, brand.code));
}
