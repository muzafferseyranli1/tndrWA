import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { channelHref } from "../../shared/channels";
import type { RatingLinkDto } from "../../shared/types";

/** Herhangi bir puan bu değerin altındaysa değerlendirme "düşük" sayılır ve arama listesine girer. */
export const LOW_SCORE_BELOW = 4;

export const newRatingToken = () => randomBytes(9).toString("base64url");

export const isLow = (taste: number, care: number, delivery: number) => Math.min(taste, care, delivery) < LOW_SCORE_BELOW;

/**
 * Değerlendirme sonrası teşekkür ekranındaki Google yorum bağlantısı (Kanallar → "Bizi değerlendirin" satırının değeri).
 * Puandan bağımsız HERKESE gösterilir: Google, yalnızca memnun müşteriyi yoruma yönlendirmeyi ("review gating") yasaklar.
 * Yemeksepeti/Trendyol Go yorumları o platformdan verilen siparişe bağlı olduğu için burada gösterilmez.
 */
export async function reviewLinks(db: PrismaClient, brandId: number): Promise<RatingLinkDto[]> {
  const review = await db.brandChannel.findFirst({ where: { brandId, kind: "REVIEW" } });
  const href = review?.value ? channelHref("REVIEW", review.value) : null;
  return href ? [{ label: "Google'da değerlendirin", href }] : [];
}
