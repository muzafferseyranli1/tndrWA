import type { PrismaClient } from "@prisma/client";

const key = (brandCode: string) => `catalog.thumbnail.${brandCode}`;

/** Müşteriye giden katalog mesajının üstünde görünen ürün görseli: seçilen ürünün retailer_id'si (boşsa WhatsApp katalogdaki ilk ürünü kullanır). */
export async function getCatalogThumbnail(db: PrismaClient, brandCode: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key: key(brandCode) } });
  return row?.value.trim() ? row.value.trim() : null;
}

export async function setCatalogThumbnail(db: PrismaClient, brandCode: string, retailerId: string | null): Promise<void> {
  if (!retailerId) {
    await db.setting.deleteMany({ where: { key: key(brandCode) } });
    return;
  }
  await db.setting.upsert({ where: { key: key(brandCode) }, create: { key: key(brandCode), value: retailerId }, update: { value: retailerId } });
}
