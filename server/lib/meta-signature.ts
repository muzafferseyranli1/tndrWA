import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta webhook imzası: `X-Hub-Signature-256: sha256=<hex>`, gövdenin uygulama sırrıyla HMAC-SHA256 değeri.
 * Doğrulama HAM gövde baytları üzerinden yapılmalıdır.
 */
export function metaSignature(rawBody: Buffer, appSecret: string): string {
  return "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
}

export function verifyMetaSignature(rawBody: Buffer, appSecret: string, header: string | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(metaSignature(rawBody, appSecret), "utf8");
  const given = Buffer.from(header.trim().toLowerCase(), "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Doğrulama anahtarı karşılaştırması (zamanlama sızıntısı olmadan). */
export function sameSecret(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
