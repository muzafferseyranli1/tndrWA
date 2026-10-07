import type { Brand, Customer, Order, PrismaClient } from "@prisma/client";
import type { OrderStatus } from "./orders";
import type { WhatsappCloudClient } from "./whatsapp-cloud";

export type MessageKey = OrderStatus | "WELCOME";
export const MESSAGE_KEYS: MessageKey[] = ["WELCOME", "NEW", "PREPARING", "ON_THE_WAY", "DELIVERED", "CANCELLED"];

/** Müşteriye giden varsayılan metinler. Ayarlar tablosunda marka başına `tpl.<marka>.<ANAHTAR>` ile değiştirilebilir. */
export const DEFAULT_TEMPLATES: Record<MessageKey, string> = {
  WELCOME: "Merhaba {ad}, hoş geldiniz! Menümüzü görmek için aşağıdaki katalog düğmesine dokunabilirsiniz.",
  NEW: "Merhaba {ad}, siparişinizi aldık (No: {no}). Hazırlanmaya başlayınca haber vereceğiz.",
  PREPARING: "Siparişiniz hazırlanıyor (No: {no}).",
  ON_THE_WAY: "Siparişiniz yola çıktı (No: {no}). Afiyet olsun!",
  DELIVERED: "Siparişiniz teslim edildi (No: {no}). Afiyet olsun!",
  CANCELLED: "Siparişiniz (No: {no}) iptal edildi. Bilgi almak için bu hattan yazabilirsiniz.",
};

/** {ad} ve {no} yer tutucularını doldurur; ad yoksa "Merhaba {ad}," gibi kalıplar düzgün kalsın diye boşluk ve virgül toparlanır. */
export function renderTemplate(template: string, vars: { ad: string | null; no?: number | null }): string {
  const ad = vars.ad?.trim() ?? "";
  return template
    .replaceAll("{no}", vars.no == null ? "" : String(vars.no))
    .replaceAll("{ad}", ad)
    .replace(/\s+,/g, ",")
    .replace(/ {2,}/g, " ")
    .trim();
}

export interface NotifyResult {
  sent: boolean;
  /** Gönderilemediyse sebebi (panelde personele gösterilir) */
  error?: string;
}

export const templateKey = (brandCode: string, key: MessageKey) => `tpl.${brandCode}.${key}`;

export async function templateFor(db: PrismaClient, brandCode: string, key: MessageKey): Promise<string> {
  const row = await db.setting.findUnique({ where: { key: templateKey(brandCode, key) } });
  return row?.value?.trim() ? row.value : DEFAULT_TEMPLATES[key];
}

/** Siparişin yeni durumunu müşteriye WhatsApp'tan bildirir. Hata fırlatmaz; sonucu döndürür (sipariş durumu yine de değişir). */
export async function notifyOrderStatus(
  db: PrismaClient,
  cloud: WhatsappCloudClient | null,
  order: Order & { brand: Brand; customer: Customer },
  status: OrderStatus,
): Promise<NotifyResult> {
  if (!cloud) return { sent: false, error: "WhatsApp gönderim jetonu tanımlı değil." };
  if (!order.brand.waPhoneNumberId) return { sent: false, error: "Markanın Cloud API numara kimliği girilmemiş." };
  if (!order.customer.waId) return { sent: false, error: "Müşterinin telefon numarası yok (yalnızca Meta kullanıcı kimliği var)." };
  try {
    const text = renderTemplate(await templateFor(db, order.brand.code, status), { ad: order.customer.name, no: order.id });
    await cloud.sendText(order.brand.waPhoneNumberId, order.customer.waId, text);
    return { sent: true };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}
