import type { PrismaClient } from "@prisma/client";

/** Aynı adresin farklı yazımlarını tek kayıtta toplamak için anahtar. */
export const addressKey = (text: string) => text.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr");

/** Müşterinin adres listesine ekler (varsa kullanım zamanını yeniler). */
export async function rememberAddress(db: PrismaClient, customerId: number, text: string, lat?: number | null, lng?: number | null): Promise<void> {
  const key = addressKey(text);
  if (!key) return;
  await db.customerAddress.upsert({
    where: { customerId_key: { customerId, key } },
    create: { customerId, text: text.trim(), key, lat: lat ?? null, lng: lng ?? null },
    update: { lastUsedAt: new Date(), ...(lat != null && lng != null ? { lat, lng } : {}) },
  });
}
