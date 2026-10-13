import { percentOf } from "./money";
import { istanbulClock } from "./hours";

/**
 * Kampanyalar burada kod olarak tanımlıdır (ayrı bir kampanya motoru yok). Yeni kampanya = yeni kural + test.
 * Ödeme şekli indirimi (nakit/kart %15) her zaman geçerlidir; kampanya yalnızca kendi ürünlerinde onun yerine geçer.
 * Kampanya yalnızca indirimli ödeme şekillerinde (nakit, kapıda kredi kartı: oranı > 0 olanlar) uygulanır; yemek kartlarında uygulanmaz.
 */
export const ET_TANDIR_CAMPAIGN = {
  brandCode: "tandir",
  /** 0=Pazar … 4=Perşembe. 2 (Salı) yalnızca deneme için, kaldırılacak. */
  days: [2, 4],
  /** Bu saatten (İstanbul) önce gelen siparişlerde geçerli */
  untilMinutes: 18 * 60,
  /** Sepet (indirimsiz liste) toplamı en az bu kadar olmalı */
  minTotalKurus: 100_000,
  category: "Et Tandırlar",
  percent: 50,
  name: "Perşembe kampanyası",
};

export interface DiscountItem {
  unitKurus: number;
  extraKurus: number;
  quantity: number;
  /** Ürünün kategorisi (ürün silinmişse boş) */
  categoryName: string | null;
}

export interface DiscountInput {
  brandCode: string;
  /** Siparişin geldiği an: kampanya günü ve saati buna göre */
  createdAt: Date;
  /** Seçilen ödeme şeklinin indirim oranı */
  paymentPercent: number;
  items: DiscountItem[];
}

export interface DiscountResult {
  discountKurus: number;
  /** Kampanya uygulandıysa açıklaması (panel ve müşteri mesajında görünür), yoksa boş */
  note: string;
}

const lineKurus = (i: DiscountItem) => (i.unitKurus + i.extraKurus) * i.quantity;
const isCampaignCategory = (name: string | null) => (name ?? "").trim().toLocaleLowerCase("tr") === ET_TANDIR_CAMPAIGN.category.toLocaleLowerCase("tr");

/** Kampanya bu sipariş için geçerli mi (marka, gün, saat, tutar ve kampanyalı ürün var mı). */
export function etTandirCampaignApplies(input: Omit<DiscountInput, "paymentPercent">): boolean {
  const c = ET_TANDIR_CAMPAIGN;
  if (input.brandCode !== c.brandCode) return false;
  const { dow, minutes } = istanbulClock(input.createdAt);
  if (!c.days.includes(dow) || minutes >= c.untilMinutes) return false;
  const total = input.items.reduce((s, i) => s + lineKurus(i), 0);
  return total >= c.minTotalKurus && input.items.some((i) => isCampaignCategory(i.categoryName));
}

/** Siparişin indirimi: kampanya yoksa ödeme şekli oranı toplamın üzerinden; kampanyada kampanyalı ürünler %50, diğerleri ödeme oranı. */
export function computeDiscount(input: DiscountInput): DiscountResult {
  const total = input.items.reduce((s, i) => s + lineKurus(i), 0);
  if (input.paymentPercent <= 0 || !etTandirCampaignApplies(input)) return { discountKurus: input.paymentPercent > 0 ? percentOf(total, input.paymentPercent) : 0, note: "" };
  const c = ET_TANDIR_CAMPAIGN;
  const discountKurus = input.items.reduce((s, i) => {
    const pct = isCampaignCategory(i.categoryName) ? c.percent : input.paymentPercent;
    return s + percentOf(lineKurus(i), pct);
  }, 0);
  const note = `${c.name}: ${c.category} %${c.percent}, diğer ürünler %${input.paymentPercent}`;
  return { discountKurus, note };
}
