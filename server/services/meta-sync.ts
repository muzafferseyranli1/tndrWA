import type { Brand, PrismaClient } from "@prisma/client";
import { availabilityOf, type ProductStatus } from "../../shared/availability";
import type { SyncSummaryDto } from "../../shared/types";
import type { MetaEnv } from "../lib/env";
import { logger } from "../lib/logger";
import { MetaCatalogClient, buildItemData, type BatchItemError, type BatchRequest, type FetchFn } from "./meta-catalog";

const CHUNK = 100;

export interface SyncOptions {
  /** Yalnızca bu ürünler; verilmezse markanın bekleyen/hatalı tüm ürünleri. */
  ids?: number[];
}

/** Süresi dolan "bugün tükendi" işaretlerini temizler. Etkilenen markaların kimliklerini döndürür. */
export async function refreshExpiredSoldOut(db: PrismaClient, now: Date): Promise<number[]> {
  const expired = await db.product.findMany({ where: { soldOutUntil: { lte: now } }, select: { brandId: true }, distinct: ["brandId"] });
  if (!expired.length) return [];
  await db.product.updateMany({ where: { soldOutUntil: { lte: now } }, data: { soldOutUntil: null, metaSyncState: "PENDING" } });
  return expired.map((e) => e.brandId);
}

/** Bir markanın ürünlerini o markanın kataloğuna eşitler. Başka markaya ait ürüne dokunmaz. */
export async function syncProducts(
  db: PrismaClient,
  client: MetaCatalogClient,
  brand: Brand,
  publicBaseUrl: string,
  options: SyncOptions = {},
  now: Date = new Date(),
): Promise<SyncSummaryDto> {
  const products = await db.product.findMany({
    where: { brandId: brand.id, ...(options.ids ? { id: { in: options.ids } } : { metaSyncState: { in: ["PENDING", "ERROR"] } }) },
    include: { category: true },
    orderBy: { id: "asc" },
  });

  const summary: SyncSummaryDto = { sent: 0, synced: 0, failed: 0, skipped: 0, errors: [] };
  const fail = async (id: number, retailerId: string, message: string) => {
    await db.product.update({ where: { id }, data: { metaSyncState: "ERROR", metaError: message } });
    summary.failed++;
    summary.errors.push({ retailerId, message });
  };

  interface Pending {
    id: number;
    retailerId: string;
    request: BatchRequest;
    putOnMeta: boolean;
  }
  const queue: Pending[] = [];

  for (const p of products) {
    const availability = availabilityOf({ status: p.status as ProductStatus, soldOutUntil: p.soldOutUntil }, now);

    if (availability === "HIDDEN") {
      if (!p.onMeta) {
        // Katalogda zaten yok, yapılacak bir şey yok
        await db.product.update({ where: { id: p.id }, data: { metaSyncState: "SYNCED", metaError: null } });
        summary.skipped++;
        continue;
      }
      queue.push({ id: p.id, retailerId: p.retailerId, request: { method: "DELETE", data: { id: p.retailerId } }, putOnMeta: false });
      continue;
    }

    const data = buildItemData({ ...p, brandName: brand.name }, availability === "IN_STOCK", publicBaseUrl);
    if (!data) {
      await fail(p.id, p.retailerId, "Görsel yüklenmemiş. Meta, ürünler için görsel ister.");
      continue;
    }
    queue.push({ id: p.id, retailerId: p.retailerId, request: { method: "CREATE", data }, putOnMeta: true });
  }

  for (let i = 0; i < queue.length; i += CHUNK) {
    const chunk = queue.slice(i, i + CHUNK);
    summary.sent += chunk.length;

    let errors: BatchItemError[];
    try {
      const handle = await client.submitBatch(chunk.map((c) => c.request));
      errors = (await client.waitForBatch(handle)).errors;
    } catch (err) {
      // Bu grup Meta'ya ulaşmadı/bitmedi: durumları değiştirme (bekliyor kalsın), hatayı yukarı bildir
      logger.warn({ err: (err as Error).message, brand: brand.code }, "Meta batch başarısız");
      throw err;
    }

    const byId = new Map<string, string>();
    let generic: string | null = null;
    for (const e of errors) {
      if (e.id) byId.set(e.id, e.message);
      else generic = e.message;
    }

    for (const item of chunk) {
      const message = byId.get(item.retailerId) ?? (byId.size === 0 ? generic : null);
      if (message) {
        await fail(item.id, item.retailerId, message);
        continue;
      }
      await db.product.update({
        where: { id: item.id },
        data: { metaSyncState: "SYNCED", metaError: null, metaSyncedAt: now, onMeta: item.putOnMeta },
      });
      summary.synced++;
    }
  }

  return summary;
}

/**
 * Marka başına eşitlemeleri sıraya koyar (bir markada aynı anda tek eşitleme) ve panel
 * değişikliklerinden sonra gecikmeli otomatik çalıştırır. Her markanın kendi katalog kimliği
 * ve (varsa) kendi jetonu vardır.
 */
export class SyncCoordinator {
  private running = new Set<number>();
  private timers = new Map<number, NodeJS.Timeout>();

  constructor(
    private readonly db: PrismaClient,
    private readonly meta: MetaEnv | null,
    private readonly publicBaseUrl: string | null,
    private readonly autoSync: boolean,
    private readonly fetchFn?: FetchFn,
    private readonly debounceMs = 3000,
  ) {}

  /** O marka için eksik ayarlar; boşsa eşitleme yapılabilir. */
  blockers(brand: Brand): string[] {
    const list: string[] = [];
    if (!this.meta) list.push("Meta ayarları eksik (META_GRAPH_VERSION, META_ACCESS_TOKEN)");
    if (!brand.metaCatalogId) list.push(`${brand.name} için Meta katalog kimliği girilmemiş (Markalar sayfası)`);
    if (!this.publicBaseUrl) list.push("PUBLIC_BASE_URL tanımlı değil (Meta görselleri bu adresten çeker)");
    return list;
  }

  isAutoSync(): boolean {
    return this.autoSync;
  }

  publicUrl(): string | null {
    return this.publicBaseUrl;
  }

  private clientFor(brand: Brand): MetaCatalogClient {
    const meta = this.meta!;
    return new MetaCatalogClient(
      { version: meta.version, catalogId: brand.metaCatalogId!, token: meta.brandTokens[brand.code] ?? meta.token, baseUrl: meta.baseUrl },
      this.fetchFn,
    );
  }

  async run(brandId: number, options: SyncOptions = {}): Promise<SyncSummaryDto> {
    const brand = await this.db.brand.findUnique({ where: { id: brandId } });
    if (!brand) throw new Error("Marka bulunamadı.");
    const blockers = this.blockers(brand);
    if (blockers.length) throw new Error(blockers.join("; "));
    if (this.running.has(brand.id)) throw new Error("Bu marka için bir eşitleme zaten sürüyor, bitmesini bekleyin.");
    this.running.add(brand.id);
    try {
      return await syncProducts(this.db, this.clientFor(brand), brand, this.publicBaseUrl!, options);
    } finally {
      this.running.delete(brand.id);
    }
  }

  /** Bir markada değişiklik olduğunda çağrılır; otomatik eşitleme açıksa kısa gecikmeyle çalıştırır. */
  trigger(brandId: number): void {
    if (!this.autoSync) return;
    const existing = this.timers.get(brandId);
    if (existing) clearTimeout(existing);
    this.timers.set(
      brandId,
      setTimeout(() => {
        this.timers.delete(brandId);
        this.run(brandId).catch((err: Error) => logger.warn({ err: err.message, brandId }, "otomatik eşitleme başarısız"));
      }, this.debounceMs),
    );
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
