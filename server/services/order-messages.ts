import type { Brand, Customer, Order, PrismaClient } from "@prisma/client";
import { formatTRY } from "../../shared/money";
import type { OrderStatus } from "./orders";
import { recordOutbound } from "./outbound";
import type { WhatsappCloudClient } from "./whatsapp-cloud";

export type MessageKey = OrderStatus | "WELCOME" | "ASK_ADDRESS" | "CONFIRM_ADDRESS" | "CHOOSE_ADDRESS" | "CONFIRMED" | "ORDER_UPDATED" | "CLOSED" | "PREORDER" | "MIN_BASKET";
export const MESSAGE_KEYS: MessageKey[] = ["WELCOME", "CLOSED", "PREORDER", "MIN_BASKET", "NEW", "ASK_ADDRESS", "CONFIRM_ADDRESS", "CHOOSE_ADDRESS", "CONFIRMED", "ORDER_UPDATED", "PREPARING", "ON_THE_WAY", "DELIVERED", "CANCELLED"];

/** Müşteriye giden varsayılan metinler. Ayarlar tablosunda marka başına `tpl.<marka>.<ANAHTAR>` ile değiştirilebilir. */
export const DEFAULT_TEMPLATES: Record<MessageKey, string> = {
  WELCOME: "Merhaba {ad}, hoş geldiniz! Menümüzü görmek için aşağıdaki katalog düğmesine dokunabilirsiniz.\n\n{kvkk}",
  CLOSED: "Merhaba {ad}, şu an kapalıyız. Çalışma saatlerimiz: {saatler}.\nBir sonraki açılış: {acilis}.\n\nSiparişleri açılıştan 1 saat önce almaya başlıyoruz, o saatten sonra tekrar yazabilirsiniz.",
  PREORDER: "Henüz açılmadık, {acilis} açılıyoruz. Siparişiniz kayıtlı; açılışla birlikte hazırlanmaya başlanır, teslimat açılıştan sonra yapılır.",
  MIN_BASKET: "Siparişiniz ({toplam}) minimum teslimat limitinin ({limit}) altında kalıyor. Siparişinizi getirebilmemiz için {eksik} değerinde daha ürün ekleyip sepeti yeniden göndermenizi rica ederiz.",
  NEW: "Merhaba {ad}, siparişinizi aldık (No: {no}). Sepet tutarı: {toplam}. Ödeme şeklinizi aşağıdan seçin. Nakit ve kapıda kredi kartı ödemelerinde %15 indirim uygulanır.\n\n{kvkk}",
  ASK_ADDRESS: "Teşekkürler. Teslimat adresinizi yazın ya da konumunuzu gönderin.",
  CONFIRM_ADDRESS: "Kayıtlı adresiniz:\n{adres}\n\nSiparişi bu adrese gönderelim mi?",
  CHOOSE_ADDRESS: "Siparişi hangi adrese gönderelim? Listeden seçebilir ya da yeni adres ekleyebilirsiniz.",
  CONFIRMED: "Siparişiniz onaylandı (No: {no}).\nÖdeme: {odeme}\nToplam: {toplam}\nİndirim: {indirim}\nÖdenecek tutar: {tutar}\nAdres: {adres}\n\nHazırlanmaya başlayınca haber vereceğiz.",
  ORDER_UPDATED: "Siparişiniz güncellendi (No: {no}).\n\n{urunler}\n\nToplam: {toplam}\nİndirim: {indirim}\nÖdenecek tutar: {tutar}\nAdres: {adres}",
  PREPARING: "Siparişiniz hazırlanıyor (No: {no}).",
  ON_THE_WAY: "Siparişiniz yola çıktı (No: {no}). Afiyet olsun!",
  DELIVERED: "Siparişiniz teslim edildi (No: {no}). Afiyet olsun!\n\nBizi değerlendirirseniz çok seviniriz: {degerlendirme}\n\nAynı siparişi tekrar vermek için bize *1* yazmanız yeterli.",
  CANCELLED: "Siparişiniz (No: {no}) iptal edildi. Bilgi almak için bu hattan yazabilirsiniz.",
};

export type TemplateVars = { ad?: string | null; no?: number | null; toplam?: string; indirim?: string; tutar?: string; odeme?: string; adres?: string; degerlendirme?: string; urunler?: string; kvkk?: string; saatler?: string; acilis?: string; limit?: string; eksik?: string };

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
    degerlendirme: vars.degerlendirme ?? "",
    urunler: vars.urunler ?? "",
    kvkk: vars.kvkk ?? "",
    saatler: vars.saatler ?? "",
    acilis: vars.acilis ?? "",
    limit: vars.limit ?? "",
    eksik: vars.eksik ?? "",
  };
  // "Adres: {adres}" gibi tek değişkenli etiket satırında değer boşsa satırı hiç gösterme ("Adres:" boş kalmasın)
  const lines = template.split("\n").filter((line) => {
    const m = line.match(/^[^{}]*:\s*\{(\w+)\}\s*$/);
    return !(m && m[1] in values && values[m[1]] === "");
  });
  let out = lines.join("\n");
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
export function orderVars(order: Order, customer: Pick<Customer, "name">, ratingUrl = ""): TemplateVars {
  const payable = order.totalKurus - order.discountKurus;
  return {
    ad: customer.name,
    no: order.id,
    toplam: formatTRY(order.totalKurus),
    indirim: order.discountKurus > 0 ? `-${formatTRY(order.discountKurus)} (%${order.discountPercent})` : "yok",
    tutar: formatTRY(payable),
    odeme: order.paymentLabel,
    adres: order.address,
    degerlendirme: ratingUrl,
  };
}

/** Teslim sonrası müşteriye giden değerlendirme bağlantısı (sipariş başına tek kullanımlık anahtar içerir). */
export function ratingUrlFor(publicBaseUrl: string | null, brandCode: string, token: string | null): string {
  return publicBaseUrl && token ? `${publicBaseUrl}/m/${brandCode}/degerlendir?t=${token}` : "";
}

/** Siparişin yeni durumunu müşteriye WhatsApp'tan bildirir. Hata fırlatmaz; sonucu döndürür (sipariş durumu yine de değişir). */
export async function notifyOrderStatus(
  db: PrismaClient,
  cloud: WhatsappCloudClient | null,
  order: Order & { brand: Brand; customer: Customer },
  status: OrderStatus,
  publicBaseUrl: string | null = null,
): Promise<NotifyResult> {
  if (!cloud) return { sent: false, error: "WhatsApp gönderim jetonu tanımlı değil." };
  if (!order.brand.waPhoneNumberId) return { sent: false, error: "Markanın Cloud API numara kimliği girilmemiş." };
  if (!order.customer.waId) return { sent: false, error: "Müşterinin telefon numarası yok (yalnızca Meta kullanıcı kimliği var)." };
  try {
    const text = renderTemplate(await templateFor(db, order.brand.code, status), orderVars(order, order.customer, ratingUrlFor(publicBaseUrl, order.brand.code, order.ratingToken)));
    const id = await cloud.sendText(order.brand.waPhoneNumberId, order.customer.waId, text);
    await recordOutbound(db, { brandId: order.brandId, customerId: order.customerId, type: "text", body: text, waMessageId: id, orderId: order.id });
    return { sent: true };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}
