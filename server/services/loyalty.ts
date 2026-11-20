import type { ApiCustomer, ApiSelection } from "./suitable-api";
import { formatTRY } from "../../shared/money";

/**
 * Müşterinin sipariş sırasında kullanabileceği kupon, puan ve hediye hakları (Suitable GET /v1/customers, loyalty:redeem kapsamı).
 * Sipariş başına `loyaltyJson` alanında saklanır: sunulan seçenekler + müşterinin seçimi + son hesaplanan indirim.
 */

export interface LoyaltyOffer {
  coupons: { id: string; name: string; detail: string }[];
  /** Harcanabilir puan ve 1 puanın TL karşılığı; puan harcama kapalıysa (pointValue 0) null */
  points: { redeemable: number; pointValue: number } | null;
  gifts: { id: string; name: string }[];
}

export interface LoyaltyState {
  offer: LoyaltyOffer;
  sel: ApiSelection;
  /** Kupon + puan indirimi (kuruş), en son Suitable'ın hesapladığı */
  discountKurus: number;
  pointsUsed?: number;
}

export const emptyOffer = (): LoyaltyOffer => ({ coupons: [], points: null, gifts: [] });
export const offerIsEmpty = (o: LoyaltyOffer): boolean => o.coupons.length === 0 && !o.points && o.gifts.length === 0;

/** Suitable müşteri kaydından kullanılabilir seçenekleri çıkarır: seçilemeyen (selectable:false) ve kampanya kuponları (kendiliğinden uygulanır) hariç. */
export function offerFromCustomer(c: ApiCustomer | null): LoyaltyOffer {
  const l = c?.loyalty;
  if (!l) return emptyOffer();
  const money = (n: number) => formatTRY(Math.round(n * 100));
  const coupons = (l.coupons ?? [])
    .filter((k) => k.selectable === true && k.type !== "campaign" && k.id)
    .map((k) => ({
      id: k.id,
      name: (k.name || "Kupon").slice(0, 60),
      detail: k.type === "percent" ? `%${k.percent ?? 0} indirim${k.maxAmount ? `, en çok ${money(k.maxAmount)}` : ""}` : k.type === "amount" ? `${money(k.amount ?? 0)} indirim` : "indirim",
    }));
  const redeemable = Math.floor(l.redeemablePoints ?? 0);
  const pointValue = l.pointValue ?? 0;
  const points = redeemable > 0 && pointValue > 0 ? { redeemable, pointValue } : null;
  const gifts = (l.giftRights ?? []).filter((g) => g.selectable === true && g.id).map((g) => ({ id: g.id, name: (g.name || "Hediye").slice(0, 60) }));
  return { coupons, points, gifts };
}

export function parseLoyalty(json: string | null | undefined): LoyaltyState | null {
  if (!json) return null;
  try {
    const s = JSON.parse(json) as LoyaltyState;
    return s && s.offer && s.sel ? s : null;
  } catch {
    return null;
  }
}

export const serializeLoyalty = (s: LoyaltyState): string => JSON.stringify(s);

/** Seçim yapılmış mı (kupon, puan ya da hediye hakkı)? */
export const hasSelection = (sel: ApiSelection | undefined): boolean => !!sel && (!!sel.couponId || (sel.pointsToRedeem ?? 0) > 0 || (sel.giftIds?.length ?? 0) > 0);

/** Liste satır kimlikleri: sunulan seçenek dizisindeki sıraya göre (c0, c1, pts, g0), "done" = tamamla. */
export interface LoyaltyChoice {
  id: string;
  title: string;
  description?: string;
}

/** Henüz seçilmemiş seçenekler + her zaman "Kullanmayacağım" / "Devam et". */
export function remainingChoices(st: LoyaltyState): LoyaltyChoice[] {
  const rows: LoyaltyChoice[] = [];
  if (st.offer.points && !(st.sel.pointsToRedeem && st.sel.pointsToRedeem > 0)) {
    const tl = Math.round(st.offer.points.redeemable * st.offer.points.pointValue * 100);
    rows.push({ id: "pts", title: "Puanımı kullan", description: `${st.offer.points.redeemable} puan = en çok ${formatTRY(tl)} indirim` });
  }
  st.offer.coupons.forEach((c, i) => {
    if (st.sel.couponId !== c.id) rows.push({ id: `c${i}`, title: c.name.slice(0, 24), description: c.detail.slice(0, 72) });
  });
  st.offer.gifts.forEach((g, i) => {
    if (!st.sel.giftIds?.includes(g.id)) rows.push({ id: `g${i}`, title: `Hediye: ${g.name}`.slice(0, 24), description: "Hediye hakkınızı kullanın" });
  });
  const anyChosen = hasSelection(st.sel);
  rows.push({ id: "done", title: anyChosen ? "Hayır, tamamla" : "Kullanmayacağım", description: anyChosen ? "Siparişi bu haliyle tamamla" : "İndirimsiz devam et" });
  return rows.slice(0, 10);
}

export function introText(st: LoyaltyState, name?: string | null): string {
  const parts: string[] = [];
  if (st.offer.points) parts.push(`${st.offer.points.redeemable} puanınız (≈ ${formatTRY(Math.round(st.offer.points.redeemable * st.offer.points.pointValue * 100))})`);
  if (st.offer.coupons.length) parts.push(`${st.offer.coupons.length} kuponunuz`);
  if (st.offer.gifts.length) parts.push(`${st.offer.gifts.length} hediye hakkınız`);
  const who = name?.trim() ? `${name.trim()}, ` : "";
  return `${who}siparişinizde kullanabileceğiniz ${parts.join(", ")} var 🎁\nKullanmak ister misiniz?`;
}

/** Seçilen kupon/puan/hediyenin kısa özeti (sipariş geçmişi ve indirim notu için). */
export function selectionSummary(st: LoyaltyState): string {
  const bits: string[] = [];
  const coupon = st.offer.coupons.find((c) => c.id === st.sel.couponId);
  if (coupon) bits.push(`kupon ${coupon.name}`);
  if ((st.pointsUsed ?? st.sel.pointsToRedeem ?? 0) > 0) bits.push(`${st.pointsUsed ?? st.sel.pointsToRedeem} puan`);
  for (const id of st.sel.giftIds ?? []) bits.push(`hediye ${st.offer.gifts.find((g) => g.id === id)?.name ?? ""}`.trim());
  return bits.join(" + ");
}
