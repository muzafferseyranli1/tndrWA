import type { Brand, Customer, PrismaClient } from "@prisma/client";
import { availabilityOf, type ProductStatus } from "../../shared/availability";
import { logger } from "../lib/logger";
import { getCatalogThumbnail } from "./catalog-thumb";
import { recordFailedOutbound, recordOutbound } from "./outbound";
import { CloudApiError, type WhatsappCloudClient } from "./whatsapp-cloud";

/**
 * Müşteriye giden menü mesajı (karşılama, panelden "Katalog gönder", sonlanan siparişten sonra):
 * - "catalog": "Kataloğu görüntüle" düğmesi (WhatsApp katalog ekranı; sıralama ve kategoriler Meta'nın elinde).
 * - "list": kategorili ürün listesi; bölümler ve ürünler paneldeki sırayla görünür.
 *   Tek mesaja sığmazsa (10 kategori / 30 ürün) önce KATEGORİ LİSTESİ gider; müşteri seçince o kategorinin ürün listesi gelir
 *   (30'dan fazla ürünlü kategori birden çok mesaja bölünür). Gönderilemezse katalog düğmesi gider.
 */
export type MenuMode = "catalog" | "list";
export const MENU_MODES: MenuMode[] = ["catalog", "list"];
export const LIST_MAX_SECTIONS = 10;
export const LIST_MAX_ITEMS = 30;
/** WhatsApp liste mesajı en fazla 10 satır: sayfa başına 9 kategori + "Diğer kategoriler" */
export const CATEGORY_PAGE_SIZE = 9;
const SECTION_TITLE_MAX = 24;
const HEADER_MAX = 60;

/** Kategori listesi satır kimlikleri: menu:cat:<kategori>, menu:page:<sayfa> */
export const menuCatId = (categoryId: number) => `menu:cat:${categoryId}`;
export const menuPageId = (page: number) => `menu:page:${page}`;

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

export interface MenuSection {
  categoryId: number | null;
  /** Tam kategori adı (kategori listesinde) */
  name: string;
  /** Ürün listesi bölüm başlığı (en fazla 24 karakter) */
  title: string;
  retailerIds: string[];
}

export interface MenuListPlan {
  sections: MenuSection[];
  items: number;
  /** Tek ürün listesine sığıyor mu; değilse nedeni `reason`da (kategori listesiyle gönderilir) */
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
  const sections: MenuSection[] = [];
  for (const c of categories) {
    const ids = usable.filter((p) => p.categoryId === c.id).map((p) => p.retailerId);
    if (ids.length) sections.push({ categoryId: c.id, name: c.name, title: sectionTitle(c.name), retailerIds: ids });
  }
  const known = new Set(categories.map((c) => c.id));
  const rest = usable.filter((p) => p.categoryId === null || !known.has(p.categoryId)).map((p) => p.retailerId);
  if (rest.length) sections.push({ categoryId: null, name: "Diğer", title: "Diğer", retailerIds: rest });

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

/** Kategori listesinin bir sayfası: en fazla 9 kategori, sonrası varsa "Diğer kategoriler ▶" satırı. */
export function categoryPage(sections: MenuSection[], page: number): { rows: { id: string; title: string; description: string }[]; pages: number } {
  const withId = sections.filter((s) => s.categoryId !== null);
  // Sayfa başları: kalan kategori 10'dan fazlaysa 9 kategori + "Diğer kategoriler", son sayfada 10'a kadar kategori
  const starts = [0];
  while (withId.length - starts[starts.length - 1] > LIST_MAX_SECTIONS) starts.push(starts[starts.length - 1] + CATEGORY_PAGE_SIZE);
  const pages = starts.length;
  const p = Math.min(Math.max(1, page), pages);
  const start = starts[p - 1];
  const last = p === pages;
  const slice = withId.slice(start, last ? start + LIST_MAX_SECTIONS : start + CATEGORY_PAGE_SIZE);
  const rows = slice.map((s) => ({ id: menuCatId(s.categoryId!), title: s.title, description: `${s.retailerIds.length} ürün` }));
  if (!last) rows.push({ id: menuPageId(p + 1), title: "Diğer kategoriler ▶", description: `${withId.length - start - CATEGORY_PAGE_SIZE} kategori daha` });
  return { rows, pages };
}

/** Ürünleri en fazla 30'luk parçalara böler (bir ürün listesi mesajı). */
export function chunkItems<T>(items: T[], size = LIST_MAX_ITEMS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function buildMenuList(db: PrismaClient, brandId: number, now: Date = new Date()): Promise<MenuListPlan> {
  const [categories, products] = await Promise.all([
    db.category.findMany({ where: { brandId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    db.product.findMany({ where: { brandId, status: "ACTIVE", onMeta: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { retailerId: true, categoryId: true, status: true, soldOutUntil: true, onMeta: true } }),
  ]);
  return planMenuList(categories, products as PlanProduct[], now);
}

const header = (brand: Brand, extra = "") => `${brand.name} Menü${extra}`.slice(0, HEADER_MAX);

async function sendCategoryList(cloud: WhatsappCloudClient, brand: Brand, to: string, text: string, plan: MenuListPlan, page: number): Promise<string | null> {
  const { rows } = categoryPage(plan.sections, page);
  return cloud.sendList(brand.waPhoneNumberId!, to, { body: text, buttonText: "Kategoriler", rows });
}

/** Markanın ayarına göre menü mesajını gönderir; mesaj kimliğini döndürür. Liste gönderilemezse katalog düğmesine düşer. */
export async function sendMenu(db: PrismaClient, cloud: WhatsappCloudClient, brand: Brand, to: string, text: string): Promise<string | null> {
  if (!brand.waPhoneNumberId) throw new CloudApiError(`${brand.name} için Cloud API telefon numarası kimliği girilmemiş.`);
  if (brand.metaCatalogId && (await getMenuMode(db, brand.code)) === "list") {
    const plan = await buildMenuList(db, brand.id);
    try {
      if (plan.fits) return await cloud.sendProductList(brand.waPhoneNumberId, to, { catalogId: brand.metaCatalogId, header: header(brand), body: text, sections: plan.sections });
      if (plan.items > 0) return await sendCategoryList(cloud, brand, to, `${text}\n\nKategori seçin, ürünler gelsin.`.trim(), plan, 1);
      logger.warn({ brand: brand.code, reason: plan.reason }, "Ürün listesi boş, katalog düğmesi gönderiliyor");
    } catch (err) {
      if (!(err instanceof CloudApiError)) throw err;
      logger.warn({ code: err.code, err: err.message, brand: brand.code }, "Ürün listesi gönderilemedi, katalog düğmesi gönderiliyor");
    }
  }
  return cloud.sendCatalog(brand.waPhoneNumberId, to, text, await getCatalogThumbnail(db, brand.code));
}

/**
 * Kategori listesinden seçim (menu:cat:<id>) ya da sonraki sayfa (menu:page:<n>): o kategorinin ürün listesi
 * (30'dan fazlaysa parçalar halinde) ya da kategori listesinin sonraki sayfası gider. Menü seçimi değilse false.
 */
export async function handleMenuReply(db: PrismaClient, cloud: WhatsappCloudClient | null, brand: Brand, customer: Customer, raw: unknown): Promise<boolean> {
  const m = (raw ?? {}) as { interactive?: { list_reply?: { id?: string }; button_reply?: { id?: string } } };
  const id = m.interactive?.list_reply?.id ?? m.interactive?.button_reply?.id ?? "";
  const match = id.match(/^menu:(cat|page):(\d+)$/);
  if (!match) return false;
  if (!cloud || !brand.waPhoneNumberId || !brand.metaCatalogId || !customer.waId) return true;
  try {
    const plan = await buildMenuList(db, brand.id);
    if (match[1] === "page") {
      const text = "Diğer kategoriler:";
      const wa = await sendCategoryList(cloud, brand, customer.waId, text, plan, Number(match[2]));
      await recordOutbound(db, { brandId: brand.id, customerId: customer.id, type: "catalog", body: text, waMessageId: wa });
      return true;
    }
    const section = plan.sections.find((s) => s.categoryId === Number(match[2]));
    if (!section) {
      const text = "Bu kategoride şu an sipariş verilebilecek ürün yok. Başka bir kategori seçebilirsiniz.";
      const wa = await cloud.sendText(brand.waPhoneNumberId, customer.waId, text);
      await recordOutbound(db, { brandId: brand.id, customerId: customer.id, type: "text", body: text, waMessageId: wa });
      return true;
    }
    const parts = chunkItems(section.retailerIds);
    for (const [i, ids] of parts.entries()) {
      const part = parts.length > 1 ? ` (${i + 1}/${parts.length})` : "";
      const body = i === 0 ? `${section.name}: ürünleri sepete ekleyin. Sepetiniz korunur; bitince sepeti gönderin.` : `${section.name}${part}`;
      const wa = await cloud.sendProductList(brand.waPhoneNumberId, customer.waId, { catalogId: brand.metaCatalogId, header: header(brand, ` · ${section.name}${part}`), body, sections: [{ title: section.title, retailerIds: ids }] });
      await recordOutbound(db, { brandId: brand.id, customerId: customer.id, type: "catalog", body: `${section.name}${part}`, waMessageId: wa });
    }
    // Ürünlerin hemen altına kategori listesi yeniden: müşteri yukarı kaydırmadan başka kategoriden ekleyebilsin
    const more = "Başka kategoriden eklemek için seçin (sepetiniz korunur). Bitince sepeti gönderin.";
    try {
      const wa = await sendCategoryList(cloud, brand, customer.waId, more, plan, 1);
      await recordOutbound(db, { brandId: brand.id, customerId: customer.id, type: "catalog", body: more, waMessageId: wa });
    } catch (err) {
      logger.warn({ err: (err as Error).message, brand: brand.code }, "Kategori listesi yeniden gönderilemedi");
    }
  } catch (err) {
    const reason = (err as Error).message;
    logger.warn({ err: reason, brand: brand.code, id }, "Kategori menüsü gönderilemedi");
    // Yazışmada kırmızı "gitmedi" + sebep: personel görür
    await recordFailedOutbound(db, { brandId: brand.id, customerId: customer.id, type: "catalog", body: `Kategori menüsü (${id})`, waMessageId: null }, `Ürün listesi: ${reason}`).catch(() => undefined);
    const text = "Menü şu an gösterilemiyor. Kataloğu açmak için aşağıdaki düğmeye dokunabilirsiniz.";
    try {
      const wa = await cloud.sendCatalog(brand.waPhoneNumberId, customer.waId, text, await getCatalogThumbnail(db, brand.code));
      await recordOutbound(db, { brandId: brand.id, customerId: customer.id, type: "catalog", body: text, waMessageId: wa });
    } catch (err2) {
      await recordFailedOutbound(db, { brandId: brand.id, customerId: customer.id, type: "catalog", body: text, waMessageId: null }, `Katalog düğmesi: ${(err2 as Error).message}`).catch(() => undefined);
    }
  }
  return true;
}
