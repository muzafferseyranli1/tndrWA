import type { Availability, ProductStatus } from "./availability";

export interface CategoryDto {
  id: number;
  name: string;
}

export interface ProductDto {
  id: number;
  retailerId: string;
  name: string;
  description: string;
  priceKurus: number;
  priceText: string;
  categoryId: number;
  categoryName: string;
  imageUrl: string | null;
  status: ProductStatus;
  soldOutUntil: string | null;
  availability: Availability;
  sortOrder: number;
  metaSyncState: "PENDING" | "SYNCED" | "ERROR";
  metaError: string | null;
  metaSyncedAt: string | null;
}

export interface MetaStatusDto {
  configured: boolean;
  publicBaseUrl: string | null;
  autoSync: boolean;
  counts: { pending: number; synced: number; error: number };
  /** Eşitlemeyi engelleyen eksikler (boşsa eşitleme yapılabilir). */
  blockers: string[];
}

export interface SyncSummaryDto {
  sent: number;
  synced: number;
  failed: number;
  skipped: number;
  errors: { retailerId: string; message: string }[];
}
