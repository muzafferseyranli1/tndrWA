import type { Brand, Customer, Order, PrismaClient } from "@prisma/client";
import { formatTRY } from "../../shared/money";
import type { OrderStatus } from "./orders";
import { recordOutbound } from "./outbound";
import type { WhatsappCloudClient } from "./whatsapp-cloud";

export type MessageKey = OrderStatus | "WELCOME" | "ASK_ADDRESS" | "CONFIRM_ADDRESS" | "CONFIRMED";
export const MESSAGE_KEYS: MessageKey[] = ["WELCOME", "NEW", "ASK_ADDRESS", "CONFIRM_ADDRESS", "CONFIRMED", "PREPARING", "ON_THE_WAY", "DELIVERED", "CANCELLED"];

/** Müşteriye giden varsayılan metinler. Ayarlar tablosunda marka başına `tpl.<marka>.<ANAHTAR>` ile değiştirilebilir. */
export const DEFAULT_TEMPLATES: Record<MessageKey, string> = {
  WELCOME: "Merhaba {ad}, hoş geldiniz! Menümüzü görmek için aşağıdaki katalog düğmesine dokunabilirsiniz.",
  NEW: "Merhaba {ad}, siparişinizi aldık (No: {no}). Sepet tutarı: {toplam}. Ödeme şeklinizi aşağıdan seçin. Nakit ve kapıda kredi kartı ödemelerinde %15 indirim uygulanır.",
  ASK_ADDRESS: "Teşekkürler. Teslimat adresinizi yazın ya da konumunuzu gönderin.",
  CONFIRM_ADDRESS: "Kayıtlı adresiniz:\n{adres}\n\nSiparişi bu adrese gönderelim mi?",
  CONFIRMED: "Siparişiniz onaylandı (No: {no}).\nÖdeme: {odeme}\nToplam: {toplam}\nİndirim: {indirim}\nÖdenecek tutar: {tutar}\nAdres: {adres}\n\nHazırlanmaya başlayınca haber vereceğiz.",
  PREPARING: "Siparişiniz hazırlanıyor (No: {no}).",
  ON_THE_WAY: "Siparişiniz yola çıktı (No: {no}). Afiyet olsun!",
  DELIVERED: "Siparişiniz teslim edildi (No: {no}). Afiyet olsun!",
  CANCELLED: "Siparişiniz (No: {no}) iptal edildi. Bilgi almak için bu hattan yazabilirsiniz.",
};

export type TemplateVars = { ad?: string | null; no?: number | null; toplam?: string; indirim?: string; tutar?: string; odeme?: string; adres?: string };

/** Yer tutucuları doldurur; ad yoksa "Merhaba {ad}," gibi kalıplar düzgün kalsın diye boşluk ve virgül toparlanır. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const values: Record<string, string> = {
    ad: vars.ad?.trim() ?? "",
    no: vars.no == null ? "" : String(vars.no),
    toplam: vars.toplam ?? "",
    indirim: vars.indirim ?? "",
    tutar: vars.tutar ?? "",
    odeme: vars.odeme ?? "",
    adres: vars.adres ?? "",
  };
  let out = template;
  for (const [key, value] of Object.entries(values)) out = out.replaceAll(`{${key}}`, value);
  return out
    .replace(/[ \t]+,/g, ",")
    .replace(/[ \t]{2,}/g, " ")
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

/** Siparişin tutarlarını yer tutucu değerlerine çevirir. */
export function orderVars(order: Order, customer: Pick<Customer, "name">): TemplateVars {
  const payable = order.totalKurus - order.discountKurus;
  return {
    ad: customer.name,
    no: order.id,
    toplam: formatTRY(order.totalKurus),
    indirim: order.discountKurus > 0 ? `-${formatTRY(order.discountKurus)} (%${order.discountPercent})` : "yok",
    tutar: formatTRY(payable),
    odeme: order.paymentLabel,
    adres: order.address,
  };
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
    const text = renderTemplate(await templateFor(db, order.brand.code, status), orderVars(order, order.customer));
    const id = await cloud.sendText(order.brand.waPhoneNumberId, order.customer.waId, text);
    await recordOutbound(db, { brandId: order.brandId, customerId: order.customerId, type: "text", body: text, waMessageId: id, orderId: order.id });
    return { sent: true };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}
