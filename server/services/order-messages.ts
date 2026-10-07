import type { Brand, Customer, Order, PrismaClient } from "@prisma/client";
import type { OrderStatus } from "./orders";
import type { WhatsappCloudClient } from "./whatsapp-cloud";

/** Durum değişince müşteriye giden varsayılan metinler. Ayarlar tablosunda `tpl.<DURUM>` anahtarıyla değiştirilebilir. */
export const DEFAULT_TEMPLATES: Record<OrderStatus, string> = {
  NEW: "Merhaba {ad}, siparişinizi aldık (No: {no}). Hazırlanmaya başlayınca haber vereceğiz.",
  PREPARING: "Siparişiniz hazırlanıyor (No: {no}).",
  ON_THE_WAY: "Siparişiniz yola çıktı (No: {no}). Afiyet olsun!",
  DELIVERED: "Siparişiniz teslim edildi (No: {no}). Afiyet olsun!",
  CANCELLED: "Siparişiniz (No: {no}) iptal edildi. Bilgi almak için bu hattan yazabilirsiniz.",
};

/** {ad} ve {no} yer tutucularını doldurur; ad yoksa "Merhaba {ad}," gibi kalıplar düzgün kalsın diye boşluk ve virgül toparlanır. */
export function renderTemplate(template: string, vars: { ad: string | null; no: number }): string {
  const ad = vars.ad?.trim() ?? "";
  return template
    .replaceAll("{no}", String(vars.no))
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

export async function templateFor(db: PrismaClient, status: OrderStatus): Promise<string> {
  const row = await db.setting.findUnique({ where: { key: `tpl.${status}` } });
  return row?.value?.trim() ? row.value : DEFAULT_TEMPLATES[status];
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
    const text = renderTemplate(await templateFor(db, status), { ad: order.customer.name, no: order.id });
    await cloud.sendText(order.brand.waPhoneNumberId, order.customer.waId, text);
    return { sent: true };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}
