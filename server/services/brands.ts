import type { Brand, PrismaClient } from "@prisma/client";
import type { Env } from "../lib/env";
import { logger } from "../lib/logger";

/** Açılışta: varsayılan markanın (ilk marka) katalog kimliği boşsa META_CATALOG_ID ile doldurur. */
export async function bootstrapBrands(db: PrismaClient, env: Env): Promise<void> {
  const first = await db.brand.findFirst({ orderBy: { sortOrder: "asc" } });
  if (!first) {
    logger.warn("Hiç marka yok; migration uygulanmamış olabilir.");
    return;
  }
  const catalogId = env.meta?.defaultCatalogId;
  if (catalogId && !first.metaCatalogId) {
    await db.brand.update({ where: { id: first.id }, data: { metaCatalogId: catalogId } });
    logger.info(`${first.name}: Meta katalog kimliği META_CATALOG_ID'den dolduruldu`);
  }
}

/** ?brandId=... verilmişse o marka, verilmemişse ilk marka. Bulunamazsa null. */
export async function resolveBrand(db: PrismaClient, raw: unknown): Promise<Brand | null> {
  if (raw === undefined || raw === "") return db.brand.findFirst({ orderBy: { sortOrder: "asc" } });
  const id = Number(raw);
  return Number.isInteger(id) ? db.brand.findUnique({ where: { id } }) : null;
}
