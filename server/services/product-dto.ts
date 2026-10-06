import type { Category, Product } from "@prisma/client";
import { availabilityOf, type ProductStatus } from "../../shared/availability";
import { formatTRY } from "../../shared/money";
import type { ProductDto } from "../../shared/types";

export type ProductWithCategory = Product & { category: Category };

export function toProductDto(p: ProductWithCategory, now: Date = new Date()): ProductDto {
  const status = p.status as ProductStatus;
  return {
    id: p.id,
    retailerId: p.retailerId,
    name: p.name,
    description: p.description,
    priceKurus: p.priceKurus,
    priceText: formatTRY(p.priceKurus),
    categoryId: p.categoryId,
    categoryName: p.category.name,
    imageUrl: p.imagePath ? `/uploads/${p.imagePath}` : null,
    status,
    soldOutUntil: p.soldOutUntil ? p.soldOutUntil.toISOString() : null,
    availability: availabilityOf({ status, soldOutUntil: p.soldOutUntil }, now),
    sortOrder: p.sortOrder,
    metaSyncState: p.metaSyncState as ProductDto["metaSyncState"],
    metaError: p.metaError,
    metaSyncedAt: p.metaSyncedAt ? p.metaSyncedAt.toISOString() : null,
  };
}
