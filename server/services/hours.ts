import type { Brand, Customer, PrismaClient } from "@prisma/client";
import { DEFAULT_HOURS, TIME_RE, hoursSummary, nextOpeningText, orderingState, type HoursConfig, type OrderingState } from "../../shared/hours";
import { formatTRY } from "../../shared/money";
import { logger } from "../lib/logger";
import { renderTemplate, templateFor } from "./order-messages";
import { recordOutbound } from "./outbound";
import type { WhatsappCloudClient } from "./whatsapp-cloud";

const key = (brandCode: string) => `hours.${brandCode}`;
const minKey = (brandCode: string) => `minbasket.${brandCode}`;

const validTime = (v: unknown): v is string => typeof v === "string" && TIME_RE.test(v);

/** Markanın çalışma saatleri (kayıt yoksa ya da bozuksa varsayılan). */
export async function getHours(db: PrismaClient, brandCode: string): Promise<HoursConfig> {
  const row = await db.setting.findUnique({ where: { key: key(brandCode) } });
  if (!row) return DEFAULT_HOURS;
  try {
    const v = JSON.parse(row.value) as Partial<HoursConfig>;
    if (validTime(v.weekday?.open) && validTime(v.weekday?.close) && validTime(v.weekend?.open) && validTime(v.weekend?.close)) {
      return { enabled: v.enabled !== false, weekday: { open: v.weekday!.open, close: v.weekday!.close }, weekend: { open: v.weekend!.open, close: v.weekend!.close } };
    }
  } catch {
    /* bozuk kayıt: varsayılana dön */
  }
  return DEFAULT_HOURS;
}

export async function setHours(db: PrismaClient, brandCode: string, cfg: HoursConfig): Promise<void> {
  const value = JSON.stringify(cfg);
  await db.setting.upsert({ where: { key: key(brandCode) }, create: { key: key(brandCode), value }, update: { value } });
}

/** Minimum sepet tutarı (kuruş); 0 = sınır yok. */
export async function getMinBasket(db: PrismaClient, brandCode: string): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: minKey(brandCode) } });
  const n = Number(row?.value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export async function setMinBasket(db: PrismaClient, brandCode: string, kurus: number): Promise<void> {
  await db.setting.upsert({ where: { key: minKey(brandCode) }, create: { key: minKey(brandCode), value: String(kurus) }, update: { value: String(kurus) } });
}

export async function brandOrderingState(db: PrismaClient, brand: Pick<Brand, "code">, now = new Date()): Promise<OrderingState> {
  return orderingState(await getHours(db, brand.code), now);
}

async function send(db: PrismaClient, cloud: WhatsappCloudClient | null, brand: Brand, customer: Customer, body: string, orderId?: number): Promise<void> {
  if (!cloud || !brand.waPhoneNumberId || !customer.waId) return;
  const id = await cloud.sendText(brand.waPhoneNumberId, customer.waId, body);
  await recordOutbound(db, { brandId: brand.id, customerId: customer.id, type: "text", body, waMessageId: id, orderId: orderId ?? null });
}

/** Kapalı mesajı: kapalıyken sepet gönderen ya da "1" yazan müşteriye. Hata fırlatmaz. */
export async function sendClosedNotice(db: PrismaClient, cloud: WhatsappCloudClient | null, brand: Brand, customer: Customer, now = new Date()): Promise<void> {
  try {
    const cfg = await getHours(db, brand.code);
    const body = renderTemplate(await templateFor(db, brand.code, "CLOSED"), { ad: customer.name, saatler: hoursSummary(cfg), acilis: nextOpeningText(cfg, now) });
    await send(db, cloud, brand, customer, body);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Kapalı mesajı gönderilemedi");
  }
}

/** Minimum sepet altında kalan müşteriye ne kadar daha ürün ekleyeceğini söyler. Hata fırlatmaz. */
export async function sendMinBasketNotice(db: PrismaClient, cloud: WhatsappCloudClient | null, brand: Brand, customer: Customer, totalKurus: number, minKurus: number): Promise<void> {
  try {
    const body = renderTemplate(await templateFor(db, brand.code, "MIN_BASKET"), { ad: customer.name, limit: formatTRY(minKurus), eksik: formatTRY(Math.max(0, minKurus - totalKurus)), toplam: formatTRY(totalKurus) });
    await send(db, cloud, brand, customer, body);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Minimum sepet mesajı gönderilemedi");
  }
}

/** Açılıştan önceki 1 saatte verilen siparişte müşteriye "açılışta hazırlanır" notu gönderir (açıksa hiçbir şey yapmaz). */
export async function sendPreorderNoticeIfNeeded(db: PrismaClient, cloud: WhatsappCloudClient | null, orderId: number, now = new Date()): Promise<void> {
  try {
    const order = await db.order.findUnique({ where: { id: orderId }, include: { brand: true, customer: true } });
    if (!order) return;
    const cfg = await getHours(db, order.brand.code);
    if (orderingState(cfg, now) !== "pre") return;
    const body = renderTemplate(await templateFor(db, order.brand.code, "PREORDER"), { ad: order.customer.name, no: order.id, saatler: hoursSummary(cfg), acilis: nextOpeningText(cfg, now) });
    await send(db, cloud, order.brand, order.customer, body, order.id);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Açılış öncesi sipariş notu gönderilemedi");
  }
}
