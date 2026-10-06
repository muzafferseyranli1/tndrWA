import type { PrismaClient } from "@prisma/client";
import { availabilityOf, type ProductStatus } from "../../shared/availability";
import type { SyncSummaryDto } from "../../shared/types";
import { logger } from "../lib/logger";
import { buildItemData, type BatchItemError, type BatchRequest, type MetaCatalogClient } from "./meta-catalog";

const CHUNK = 100;

export interface SyncOptions {
  /** Yalnızca bu ürünler; verilmezse bekleyen/hatalı tüm ürünler. */
  ids?: number[];
}

/** Süresi dolan "bugün tükendi" işaretlerini temizler ve ürünü Meta'ya yeniden gönderilecek diye işaretler. */
export async function refreshExpiredSoldOut(db: PrismaClient, now: Date): Promise<number> {
  const res = await db.product.updateMany({
    where: { soldOutUntil: { lte: now } },
    data: { soldOutUntil: null, metaSyncState: "PENDING" },
  });
  return res.count;
}

export async function syncProducts(
  db: PrismaClient,
  client: MetaCatalogClient,
  publicBaseUrl: string,
  options: SyncOptions = {},
  now: Date = new Date(),
): Promise<SyncSummaryDto> {
  const products = await db.product.findMany({
    where: options.ids ? { id: { in: options.ids } } : { metaSyncState: { in: ["PENDING", "ERROR"] } },
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

    const data = buildItemData(p, availability === "IN_STOCK", publicBaseUrl);
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
      logger.warn({ err: (err as Error).message }, "Meta batch başarısız");
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

/** Eşitlemeleri sıraya koyar (aynı anda tek eşitleme) ve panel değişikliklerinden sonra gecikmeli otomatik çalıştırır. */
export class SyncCoordinator {
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: PrismaClient,
    private readonly client: MetaCatalogClient | null,
    private readonly publicBaseUrl: string | null,
    private readonly autoSync: boolean,
    private readonly debounceMs = 3000,
  ) {}

  /** Eksik ayarlar listesi; boşsa eşitleme yapılabilir. */
  blockers(): string[] {
    const list: string[] = [];
    if (!this.client) list.push("Meta ayarları eksik (META_GRAPH_VERSION, META_CATALOG_ID, META_ACCESS_TOKEN)");
    if (!this.publicBaseUrl) list.push("PUBLIC_BASE_URL tanımlı değil (Meta görselleri bu adresten çeker)");
    return list;
  }

  isAutoSync(): boolean {
    return this.autoSync;
  }

  publicUrl(): string | null {
    return this.publicBaseUrl;
  }

  async run(options: SyncOptions = {}): Promise<SyncSummaryDto> {
    const blockers = this.blockers();
    if (blockers.length || !this.client || !this.publicBaseUrl) throw new Error(blockers.join("; "));
    if (this.running) throw new Error("Bir eşitleme zaten sürüyor, bitmesini bekleyin.");
    this.running = true;
    try {
      return await syncProducts(this.db, this.client, this.publicBaseUrl, options);
    } finally {
      this.running = false;
    }
  }

  /** Panelde bir değişiklik olduğunda çağrılır; otomatik eşitleme açıksa kısa gecikmeyle çalıştırır. */
  trigger(): void {
    if (!this.autoSync || this.blockers().length) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.run().catch((err: Error) => logger.warn({ err: err.message }, "otomatik eşitleme başarısız"));
    }, this.debounceMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
