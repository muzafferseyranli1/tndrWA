export const CHANNEL_KINDS = ["CALL", "WHATSAPP", "YEMEKSEPETI", "TRENDYOLGO", "GETIR", "MAPS", "REVIEW"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export interface ChannelSpec {
  kind: ChannelKind;
  /** Butonda görünen varsayılan yazı */
  label: string;
  /** Panelde değer alanının ne beklediği */
  valueHint: string;
  valueType: "phone" | "url" | "place";
}

/** Açılış sayfasındaki varsayılan buton sırası. */
export const CHANNEL_SPECS: ChannelSpec[] = [
  { kind: "CALL", label: "Telefonla sipariş ver", valueHint: "Telefon numarası (örn. 0212 123 45 67)", valueType: "phone" },
  { kind: "WHATSAPP", label: "WhatsApp'tan sipariş ver", valueHint: "WhatsApp numarası (örn. 0533 123 45 67)", valueType: "phone" },
  { kind: "YEMEKSEPETI", label: "Yemeksepeti", valueHint: "Restoran sayfasının https bağlantısı", valueType: "url" },
  { kind: "TRENDYOLGO", label: "Trendyol Go", valueHint: "Restoran sayfasının https bağlantısı", valueType: "url" },
  { kind: "GETIR", label: "Getir", valueHint: "Restoran sayfasının https bağlantısı", valueType: "url" },
  { kind: "MAPS", label: "Yol tarifi al", valueHint: "Adres ya da Google Haritalar bağlantısı", valueType: "place" },
  { kind: "REVIEW", label: "Bizi değerlendirin", valueHint: "Google yorum bağlantısı (değerlendirme sonrası gösterilir; boş bırakılırsa gösterilmez)", valueType: "url" },
];

export const isChannelKind = (v: unknown): v is ChannelKind => typeof v === "string" && (CHANNEL_KINDS as readonly string[]).includes(v);

/**
 * Telefon numarasını uluslararası rakam dizisine çevirir (örn. "0533 123 45 67" -> "905331234567").
 * Geçersizse null. Türkiye numarası varsayılır: baştaki 0 atılıp 90 eklenir.
 */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = "90" + digits.slice(1);
  else if (digits.length === 10) digits = "90" + digits;
  digits = digits.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  if (digits.startsWith("90") && digits.length !== 12) return null;
  return digits;
}

/** Yalnızca https bağlantıları kabul edilir (javascript:, http: vb. reddedilir). */
export function normalizeUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== "https:" || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export type ValueResult = { ok: true; value: string } | { ok: false; error: string };

/** Panelde girilen değeri türüne göre doğrular ve saklanacak biçime çevirir. Boş değer geçerlidir (kanal kapalı kalır). */
export function validateChannelValue(kind: ChannelKind, raw: string): ValueResult {
  const text = raw.trim();
  if (!text) return { ok: true, value: "" };
  const spec = CHANNEL_SPECS.find((s) => s.kind === kind)!;
  if (spec.valueType === "phone") {
    const phone = normalizePhone(text);
    return phone ? { ok: true, value: phone } : { ok: false, error: "Geçerli bir telefon numarası girin (örn. 0212 123 45 67)." };
  }
  if (spec.valueType === "url") {
    const url = normalizeUrl(text);
    return url ? { ok: true, value: url } : { ok: false, error: "https:// ile başlayan geçerli bir bağlantı girin." };
  }
  // place: https bağlantı ya da serbest adres metni
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    const url = normalizeUrl(text);
    return url ? { ok: true, value: url } : { ok: false, error: "Harita için https:// bağlantısı ya da adres metni girin." };
  }
  if (text.length > 300) return { ok: false, error: "Adres en fazla 300 karakter olabilir." };
  return { ok: true, value: text };
}

/** Butonun gideceği adres; değer boşsa ya da türüne uymuyorsa null. */
export function channelHref(kind: ChannelKind, value: string, whatsappText = "Merhaba, sipariş vermek istiyorum."): string | null {
  const v = value.trim();
  if (!v) return null;
  if (kind === "CALL") return /^\d{10,15}$/.test(v) ? `tel:+${v}` : null;
  if (kind === "WHATSAPP") return /^\d{10,15}$/.test(v) ? `https://wa.me/${v}?text=${encodeURIComponent(whatsappText)}` : null;
  if (kind === "MAPS") return /^https:\/\//i.test(v) ? v : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(v)}`;
  return /^https:\/\//i.test(v) ? v : null;
}
