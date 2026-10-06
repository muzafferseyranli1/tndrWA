import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WAHA webhook imzası: gövdenin gizli anahtarla HMAC-SHA512 değeri (hex), `X-Webhook-Hmac` başlığında gelir.
 * Doğrulama HAM gövde baytları üzerinden yapılmalıdır (JSON'a çevrilip yeniden yazılmış hâli değil).
 */
export function wahaSignature(rawBody: Buffer, secret: string): string {
  return createHmac("sha512", secret).update(rawBody).digest("hex");
}

export function verifyWahaSignature(rawBody: Buffer, secret: string, header: string | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(wahaSignature(rawBody, secret), "utf8");
  const given = Buffer.from(header.trim().toLowerCase(), "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
