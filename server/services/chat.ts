import type { Brand, Customer, Message, PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";
import { renderTemplate, templateFor } from "./order-messages";
import { recordOutbound } from "./outbound";
import { contactFrom, upsertCustomer } from "./customers";
import type { WhatsappCloudClient } from "./whatsapp-cloud";

/** Müşteri bu süre içinde hiç yazışmadıysa ilk mesajına hoş geldin + katalog gönderilir. */
export const WELCOME_GAP_MS = 12 * 60 * 60 * 1000;
/** Meta'nın serbest metin penceresi: müşterinin son mesajından itibaren 24 saat. */
export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

const asString = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const MEDIA_LABEL: Record<string, string> = {
  image: "Görsel",
  video: "Video",
  audio: "Ses kaydı",
  voice: "Ses kaydı",
  document: "Belge",
  sticker: "Çıkartma",
  location: "Konum",
  contacts: "Kişi kartı",
  reaction: "Tepki",
};

/** Gelen mesajı panelde gösterilecek (tür, metin) çiftine çevirir. Bilinmeyen türler köşeli parantezle gösterilir. */
export function describeInbound(message: unknown): { type: string; body: string } {
  const m = message as Record<string, unknown> | null;
  const type = asString(m?.type) ?? "unknown";
  const get = (key: string) => (m?.[key] ?? null) as Record<string, unknown> | null;

  if (type === "text") return { type, body: asString(get("text")?.body) ?? "" };
  if (type === "button") return { type, body: asString(get("button")?.text) ?? "[Düğme yanıtı]" };
  if (type === "interactive") {
    const i = get("interactive");
    const reply = (i?.button_reply ?? i?.list_reply ?? null) as Record<string, unknown> | null;
    return { type, body: asString(reply?.title) ?? "[Etkileşimli yanıt]" };
  }
  const label = MEDIA_LABEL[type] ?? type;
  const caption = asString(get(type)?.caption);
  return { type, body: caption ? `[${label}] ${caption}` : `[${label}]` };
}

/** Giden mesajın başarısızlık sebebini personelin anlayacağı dille söyler. */
export function sendFailureText(message: string, code?: number): string {
  if (code === 131047 || /re-?engagement/i.test(message)) return "24 saat penceresi kapalı: müşteri son 24 saatte yazmadığı için serbest mesaj gönderilemez. Müşteri yazınca açılır.";
  if (code === 131030) return "Alıcı numarası Meta test listesinde değil.";
  return message;
}

export interface InboundRecord {
  message: Message;
  /** Meta'dan gelen ham mesaj nesnesi (düğme/liste kimliği, konum gibi ayrıntılar için) */
  raw: unknown;
  customer: Customer;
  brand: Brand;
}

/**
 * Cloud API'den gelen bir mesaj olayını (kaydedilmiş olay gövdesi, sipariş dışı) yazışmaya ekler.
 * Marka, mesajın geldiği numaranın kimliğinden bulunur. Aynı mesaj ikinci kez eklenmez.
 */
export async function recordInbound(db: PrismaClient, eventBody: string): Promise<InboundRecord | null> {
  let body: { metadata?: { phone_number_id?: unknown }; message?: { id?: unknown } };
  try {
    body = JSON.parse(eventBody);
  } catch {
    return null;
  }
  const waMessageId = asString(body.message?.id);
  const phoneNumberId = asString(body.metadata?.phone_number_id);
  if (!waMessageId || !phoneNumberId) return null;
  const brand = await db.brand.findFirst({ where: { waPhoneNumberId: phoneNumberId } });
  if (!brand) return null;
  const contact = contactFrom(body);
  if (!contact.waId && !contact.bsuid) return null;
  if (await db.message.findUnique({ where: { waMessageId } })) return null;

  const customer = await upsertCustomer(db, contact);
  const { type, body: text } = describeInbound(body.message);
  try {
    const message = await db.message.create({ data: { brandId: brand.id, customerId: customer.id, direction: "IN", type, body: text, waMessageId, status: "RECEIVED" } });
    return { message, raw: body.message, customer, brand };
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return null; // eşzamanlı yeniden gönderim
    throw err;
  }
}

const RANK: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

/** Teslim durumu olayı (sent/delivered/read/failed): giden mesajın durumunu ilerletir, geri götürmez. */
export async function recordStatus(db: PrismaClient, eventBody: string): Promise<void> {
  let body: { status?: { id?: unknown; status?: unknown; errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[] } };
  try {
    body = JSON.parse(eventBody);
  } catch {
    return;
  }
  const id = asString(body.status?.id);
  const raw = asString(body.status?.status)?.toUpperCase();
  if (!id || !raw || !(raw in RANK)) return;
  const message = await db.message.findUnique({ where: { waMessageId: id } });
  if (!message || message.direction !== "OUT") return;
  if ((RANK[message.status] ?? 0) >= RANK[raw] && message.status !== "FAILED") return;
  if (message.status === "FAILED") return;

  let error: string | null = null;
  if (raw === "FAILED") {
    const e = body.status?.errors?.[0];
    const detail = e?.error_data?.details ?? e?.message ?? e?.title ?? "Teslim edilemedi.";
    error = sendFailureText(detail, e?.code);
    logger.warn({ waMessageId: id, code: e?.code, title: e?.title }, "Giden mesaj teslim edilemedi");
  }
  await db.message.update({ where: { id: message.id }, data: { status: raw, error } });
}

/**
 * Müşteri uzun süredir yazışmadıysa (ya da ilk kez yazıyorsa) hoş geldin metniyle birlikte kataloğu gönderir.
 * Hata fırlatmaz; sipariş/yazışma kaydını etkilemez.
 */
export async function sendWelcomeIfNeeded(db: PrismaClient, cloud: WhatsappCloudClient | null, brand: Brand, customer: Customer, inbound: Message): Promise<boolean> {
  try {
    if (!cloud || !brand.waPhoneNumberId || !customer.waId || inbound.type === "order") return false;
    const since = new Date(inbound.createdAt.getTime() - WELCOME_GAP_MS);
    const recent = await db.message.count({ where: { brandId: brand.id, customerId: customer.id, createdAt: { gte: since, lt: inbound.createdAt } } });
    if (recent > 0) return false;
    const text = renderTemplate(await templateFor(db, brand.code, "WELCOME"), { ad: customer.name });
    const id = await cloud.sendCatalog(brand.waPhoneNumberId, customer.waId, text);
    await recordOutbound(db, { brandId: brand.id, customerId: customer.id, type: "catalog", body: text, waMessageId: id });
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Hoş geldin mesajı gönderilemedi");
    return false;
  }
}
