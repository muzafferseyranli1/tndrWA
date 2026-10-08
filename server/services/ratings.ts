import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { channelHref } from "../../shared/channels";
import type { RatingLinkDto } from "../../shared/types";

/** Herhangi bir puan bu değerin altındaysa değerlendirme "düşük" sayılır ve arama listesine girer. */
export const LOW_SCORE_BELOW = 4;
const MIN_SCORE_KEY = "rating.reviewMinScore";
/**
 * Dış değerlendirme bağlantıları (Google, platformlar) varsayılan olarak HERKESE gösterilir (1).
 * Google, yalnızca memnun müşterileri yorum yazmaya yönlendirmeyi yasaklar; 5 yapılırsa bu kural ihlali riski vardır.
 */
export const DEFAULT_REVIEW_MIN_SCORE = 1;

export const newRatingToken = () => randomBytes(9).toString("base64url");

export const isLow = (taste: number, care: number, delivery: number) => Math.min(taste, care, delivery) < LOW_SCORE_BELOW;

export async function reviewMinScore(db: PrismaClient): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: MIN_SCORE_KEY } });
  const n = Number(row?.value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : DEFAULT_REVIEW_MIN_SCORE;
}

export async function setReviewMinScore(db: PrismaClient, value: number): Promise<void> {
  await db.setting.upsert({ where: { key: MIN_SCORE_KEY }, create: { key: MIN_SCORE_KEY, value: String(value) }, update: { value: String(value) } });
}

const PLATFORM_LABEL: Record<string, string> = { YEMEKSEPETI: "Yemeksepeti'nde değerlendirin", TRENDYOLGO: "Trendyol Go'da değerlendirin", GETIR: "Getir'de değerlendirin" };

/** Değerlendirme sonrası gösterilecek dış bağlantılar: Google yorum bağlantısı ve açık platformlar. */
export async function reviewLinks(db: PrismaClient, brandId: number, minScore: number, ratingMin: number): Promise<RatingLinkDto[]> {
  if (ratingMin < minScore) return [];
  const channels = await db.brandChannel.findMany({ where: { brandId, enabled: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  const links: RatingLinkDto[] = [];
  for (const c of channels) {
    if (c.kind === "REVIEW" && c.value) links.push({ label: "Google'da değerlendirin", href: c.value });
    else if (PLATFORM_LABEL[c.kind]) {
      const href = channelHref(c.kind as "YEMEKSEPETI", c.value);
      if (href) links.push({ label: PLATFORM_LABEL[c.kind], href });
    }
  }
  // Google en üstte
  return links.sort((a, b) => Number(b.label.startsWith("Google")) - Number(a.label.startsWith("Google")));
}
