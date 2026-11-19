import type { Brand, PrismaClient } from "@prisma/client";
import type { SuitableEnv } from "../lib/env";
import { logger } from "../lib/logger";
import type { Messenger } from "./messenger";
import { applyPosEvents, markPosEntered, setPosAlert, type PosEvent } from "./pos-tracking";
import { buildApiOrder, menuToSnapshot, SuitableApiError, SuitableClient, type ApiMenu } from "./suitable-api";

/**
 * Siparişleri POS'a Suitable Dış Kaynak API'siyle yazar (eklenti yerine), durumlarını webhook ve yoklamayla izler.
 * Yazma yöntemi Ayar "pos.writeMode" ("api" | "extension"); API ayarları (env) yoksa her zaman eklenti.
 */

export const WRITE_MODE_KEY = "pos.writeMode";
/** "1" iken siparişler test:true ile gönderilir (puan, ziyaret, kampanya sayaçları ve stok etkilenmez; fiş ve satış raporunda görünür, denemeden sonra iptal edilmeli) */
export const TEST_ORDERS_KEY = "suitable.testOrders";
export type WriteMode = "api" | "extension";

const ORDER_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_TRIES = 8;
const BACKOFF_SEC = [20, 60, 120, 300, 600, 900, 1800];
const MENU_TTL_MS = Number(process.env.SUITABLE_MENU_TTL_MS) || 30_000;

export async function getWriteMode(db: PrismaClient, suitable: SuitableEnv | null): Promise<WriteMode> {
  if (!suitable) return "extension";
  const row = await db.setting.findUnique({ where: { key: WRITE_MODE_KEY } });
  return row?.value === "api" ? "api" : "extension";
}

export async function testOrdersOn(db: PrismaClient): Promise<boolean> {
  return (await db.setting.findUnique({ where: { key: TEST_ORDERS_KEY } }))?.value === "1";
}

export async function setTestOrders(db: PrismaClient, on: boolean): Promise<void> {
  await db.setting.upsert({ where: { key: TEST_ORDERS_KEY }, create: { key: TEST_ORDERS_KEY, value: on ? "1" : "0" }, update: { value: on ? "1" : "0" } });
}

export async function setWriteMode(db: PrismaClient, mode: WriteMode): Promise<void> {
  await db.setting.upsert({ where: { key: WRITE_MODE_KEY }, create: { key: WRITE_MODE_KEY, value: mode }, update: { value: mode } });
}

/** Markanın Suitable işletme kimliği: SUITABLE_STORE_<KOD> ya da POS şube kimliği. */
export function storeIdOf(suitable: SuitableEnv, brand: Pick<Brand, "code" | "posCafeId">): string | null {
  return suitable.stores[brand.code.toLowerCase()] ?? brand.posCafeId ?? null;
}

const backoffMs = (tries: number) => (BACKOFF_SEC[Math.min(tries - 1, BACKOFF_SEC.length - 1)] ?? 1800) * 1000;

export class SuitableSync {
  readonly client: SuitableClient;
  private readonly menus = new Map<string, { at: number; menu: ApiMenu; etag: string | null }>();

  constructor(
    private readonly db: PrismaClient,
    readonly cfg: SuitableEnv,
    private readonly cloud: Messenger | null,
    private readonly publicBaseUrl: string | null,
    client?: SuitableClient,
  ) {
    this.client = client ?? new SuitableClient({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey });
  }

  async menuOf(store: string, now = Date.now()): Promise<ApiMenu> {
    const hit = this.menus.get(store);
    if (hit && now - hit.at < MENU_TTL_MS) return hit.menu;
    // Süre dolunca ETag ile sorulur: değişmediyse gövdesiz 304 (hız sınırını harcamaz)
    const res = await this.client.getMenu(store, hit?.etag);
    if (res.notModified && hit) {
      this.menus.set(store, { ...hit, at: now });
      return hit.menu;
    }
    if (!res.menu) throw new SuitableApiError(502, "empty_menu", "Suitable menüyü boş döndürdü");
    this.menus.set(store, { at: now, menu: res.menu, etag: res.etag });
    return res.menu;
  }

  /** Hazır ve henüz POS'a yazılmamış siparişleri API'ye gönderir. Dönen: kaç sipariş yazıldı. */
  async sendPending(now = new Date()): Promise<number> {
    if ((await getWriteMode(this.db, this.cfg)) !== "api") return 0;
    const brands = await this.db.brand.findMany({ orderBy: { sortOrder: "asc" } });
    let sent = 0;
    for (const brand of brands) {
      const store = storeIdOf(this.cfg, brand);
      if (!store) continue;
      const orders = await this.db.order.findMany({
        where: {
          brandId: brand.id,
          status: { in: ["NEW", "PREPARING"] },
          stage: "READY",
          posRef: null,
          suitableId: null,
          suitableTries: { lt: MAX_TRIES },
          createdAt: { gte: new Date(now.getTime() - ORDER_WINDOW_MS) },
          OR: [{ suitableNextAt: null }, { suitableNextAt: { lte: now } }],
        },
        orderBy: { createdAt: "asc" },
        take: 10,
        include: { customer: true, items: { orderBy: { id: "asc" }, include: { options: { orderBy: { id: "asc" } } } } },
      });
      for (const order of orders) {
        if (await this.sendOne(brand, store, order, now)) sent++;
      }
    }
    return sent;
  }

  private async fail(orderId: number, err: SuitableApiError | Error, tries: number, now: Date, permanent: boolean): Promise<void> {
    const text = err.message.slice(0, 300);
    await this.db.order.update({
      where: { id: orderId },
      data: permanent ? { suitableTries: MAX_TRIES, suitableError: text, suitableNextAt: null } : { suitableTries: tries, suitableError: text, suitableNextAt: new Date(now.getTime() + backoffMs(tries)) },
    });
    if (permanent || tries >= MAX_TRIES) {
      await this.db.orderChange.create({ data: { orderId, text: `Suitable'a yazılamadı: ${text}. POS'a elle girin.` } });
      await setPosAlert(this.db, "api", `Sipariş #${orderId} Suitable'a yazılamadı: ${text}. POS'a elle girip "POS'a girildi" işaretleyin.`);
      logger.warn({ orderId, err: text }, "Sipariş Suitable'a yazılamadı");
    } else {
      logger.warn({ orderId, tries, err: text }, "Suitable'a yazılamadı, yeniden denenecek");
    }
  }

  private async sendOne(brand: Brand, store: string, order: Parameters<typeof buildApiOrder>[1] & { id: number; suitableTries: number }, now: Date): Promise<boolean> {
    const tries = order.suitableTries + 1;
    try {
      const snap = menuToSnapshot(await this.menuOf(store, now.getTime()), store);
      const built = await buildApiOrder(this.db, order, snap, store);
      if (!built.ok) {
        // Menüde karşılığı yok: bekleyince düzelmez, personel elle girer
        await this.fail(order.id, new Error(built.error), tries, now, true);
        return false;
      }
      const test = await testOrdersOn(this.db);
      const res = await this.client.createOrder(test ? { ...built.body, test: true } : built.body);
      const ref = res.receiptNo ? `#${res.receiptNo}` : `API ${res.orderId.slice(-6)}`;
      await this.db.order.update({ where: { id: order.id }, data: { suitableId: res.orderId, posRef: ref, posAt: new Date(), suitableError: null, suitableNextAt: null } });
      await this.db.orderChange.create({ data: { orderId: order.id, text: `Suitable'a yazıldı: ${ref}${test ? " (TEST siparişi: fiş ve satış raporunda görünür, işiniz bitince iptal edin)" : ""}${res.duplicate ? " (zaten kayıtlıydı)" : ""}${built.warnings.length ? ` · uyarı: ${built.warnings.join("; ")}`.slice(0, 400) : ""}` } });
      await markPosEntered(this.db, this.cloud, this.publicBaseUrl, order.id).catch((err: Error) => logger.warn({ orderId: order.id, err: err.message }, "POS girişi bildirilemedi"));
      logger.info({ orderId: order.id, suitableId: res.orderId, receiptNo: res.receiptNo, brand: brand.code }, "Sipariş Suitable'a yazıldı");
      return true;
    } catch (err) {
      const e = err as Error | SuitableApiError;
      const permanent = e instanceof SuitableApiError ? !e.retryable : true;
      await this.fail(order.id, e, tries, now, permanent || tries >= MAX_TRIES);
      return false;
    }
  }

  /** Webhook ya da yoklama: API durumunu siparişe uygular (yalnız ileri yönde). */
  async applyStatus(ref: { orderId?: string; externalId?: string }, status: string, cancelReason?: string | null, cancelledBy?: string | null): Promise<boolean> {
    const idFromExternal = ref.externalId?.startsWith("yrndwa-") ? Number(ref.externalId.slice(7)) : NaN;
    const order = await this.db.order.findFirst({
      where: { OR: [...(ref.orderId ? [{ suitableId: ref.orderId }] : []), ...(Number.isInteger(idFromExternal) ? [{ id: idFromExternal, suitableId: { not: null } }] : [])] },
      select: { id: true, status: true },
    });
    if (!order) return false;
    const event: PosEvent | null = status === "on_the_way" ? "ON_THE_WAY" : status === "delivered" ? "DELIVERED" : status === "cancelled" ? "CANCELLED" : null;
    let changed = false;
    if (event) changed = (await applyPosEvents(this.db, this.cloud, this.publicBaseUrl, [{ id: order.id, event }])) > 0;
    if (status === "cancelled" && cancelReason) {
      const text = `Suitable iptal nedeni${cancelledBy === "client" ? " (bizim iptalimiz)" : ""}: ${cancelReason.slice(0, 200)}`;
      const seen = await this.db.orderChange.findFirst({ where: { orderId: order.id, text } });
      if (!seen) await this.db.orderChange.create({ data: { orderId: order.id, text } });
    }
    return changed;
  }

  /**
   * Açık siparişlerin durumunu API'den uzlaştırır (webhook kaçırılırsa ve vazgeçilen teslimatlar için). İşletme başına tek liste isteği
   * (`GET /v1/orders?store=&since=`, sayfalı); listede görünmeyenler tek tek sorgulanır.
   */
  async pollOpen(): Promise<number> {
    const open = await this.db.order.findMany({
      where: { suitableId: { not: null }, status: { in: ["NEW", "PREPARING", "ON_THE_WAY"] }, posAt: { gte: new Date(Date.now() - ORDER_WINDOW_MS) } },
      select: { id: true, suitableId: true, posAt: true, brand: { select: { code: true, posCafeId: true } } },
      orderBy: { posAt: "asc" },
      take: 60,
    });
    if (!open.length) return 0;
    const byStore = new Map<string, typeof open>();
    for (const o of open) {
      const store = storeIdOf(this.cfg, o.brand);
      if (store) (byStore.get(store) ?? byStore.set(store, []).get(store)!).push(o);
    }
    let n = 0;
    for (const [store, orders] of byStore) {
      const seen = new Map<string, string>();
      try {
        const since = new Date((orders[0].posAt?.getTime() ?? Date.now()) - 60_000).toISOString();
        let cursor: string | undefined;
        // "orders" boş gelse bile nextCursor doluysa devam edilir
        for (let page = 0; page < 8; page++) {
          const res = await this.client.listOrders(store, { since, limit: 100, cursor });
          for (const x of res.orders) seen.set(x.orderId, x.status);
          if (!res.nextCursor) break;
          cursor = res.nextCursor;
        }
      } catch (err) {
        logger.warn({ store, err: (err as Error).message }, "Suitable sipariş listesi alınamadı, tek tek sorgulanacak");
      }
      for (const o of orders) {
        let status = seen.get(o.suitableId!);
        if (!status) {
          try {
            status = (await this.client.getOrder(o.suitableId!)).status;
          } catch (err) {
            logger.warn({ orderId: o.id, err: (err as Error).message }, "Suitable sipariş durumu sorgulanamadı");
            continue;
          }
        }
        if (await this.applyStatus({ orderId: o.suitableId! }, status)) n++;
      }
    }
    return n;
  }

  /** Panelde ya da otomatik iptal edilen siparişi Suitable'ta da iptal eder (yalnız kuryeye çıkmamışsa mümkün). */
  async cancelOrder(orderId: number, reason: string): Promise<"cancelled" | "not_cancellable" | "skipped" | "failed"> {
    const order = await this.db.order.findUnique({ where: { id: orderId }, select: { suitableId: true } });
    if (!order?.suitableId) return "skipped";
    try {
      await this.client.cancelOrder(order.suitableId, reason);
      await this.db.orderChange.create({ data: { orderId, text: "Suitable'ta da iptal edildi" } });
      return "cancelled";
    } catch (err) {
      const e = err as SuitableApiError;
      if (e.code === "not_cancellable") {
        await this.db.orderChange.create({ data: { orderId, text: "Suitable'ta iptal edilemedi (sipariş yolda ya da teslim edilmiş): işletmeyle iletişime geçin" } });
        return "not_cancellable";
      }
      await this.db.orderChange.create({ data: { orderId, text: `Suitable'ta iptal edilemedi: ${e.message}`.slice(0, 300) } });
      logger.warn({ orderId, err: e.message }, "Suitable iptali başarısız");
      return "failed";
    }
  }

  /** Başarısız yazımı personel yeniden denemek isterse sayaçları sıfırlar. */
  async retry(orderId: number): Promise<boolean> {
    const o = await this.db.order.findUnique({ where: { id: orderId }, select: { suitableId: true, posRef: true } });
    if (!o || o.suitableId || o.posRef) return false;
    await this.db.order.update({ where: { id: orderId }, data: { suitableTries: 0, suitableNextAt: null, suitableError: null } });
    return true;
  }

  start(everyMs = 5_000, pollMs = 60_000): () => void {
    let busy = false;
    let pollBusy = false;
    const t1 = setInterval(() => {
      if (busy) return;
      busy = true;
      this.sendPending()
        .catch((err: Error) => logger.warn({ err: err.message }, "Suitable gönderici çalışmadı"))
        .finally(() => {
          busy = false;
        });
    }, everyMs);
    const t2 = setInterval(() => {
      if (pollBusy) return;
      pollBusy = true;
      getWriteMode(this.db, this.cfg)
        .then((m) => (m === "api" ? this.pollOpen() : 0))
        .catch((err: Error) => logger.warn({ err: err.message }, "Suitable durum yoklaması çalışmadı"))
        .finally(() => {
          pollBusy = false;
        });
    }, pollMs);
    t1.unref();
    t2.unref();
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  }
}
