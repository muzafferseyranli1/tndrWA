import { randomBytes } from "node:crypto";

/** Herhangi bir puan bu değerin altındaysa değerlendirme "düşük" sayılır ve arama listesine girer. */
export const LOW_SCORE_BELOW = 4;

export const newRatingToken = () => randomBytes(9).toString("base64url");

export const isLow = (taste: number, care: number, delivery: number) => Math.min(taste, care, delivery) < LOW_SCORE_BELOW;
