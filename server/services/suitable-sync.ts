import type { Brand, PrismaClient } from "@prisma/client";
import type { PriceMode, SuitableEnv } from "../lib/env";
import { logger } from "../lib/logger";
import type { Messenger } from "./messenger";
import { applyPosEvents, markPosEntered, setPosAlert, type PosEvent } from "./pos-tracking";
import { apiPayment, apiPhone, buildApiLines, buildApiOrder, menuToSnapshot, SuitableApiError, SuitableClient, type ApiCustomer, type ApiEvaluateResult, type ApiMenu, type ApiOrderLine, type ApiSelection } from "./suitable-api";
import { addressKey } from "./addresses";
import { emptyOffer, hasSelection, offerFromCustomer, offerIsEmpty, parseLoyalty, selectionSummary, serializeLoyalty, type LoyaltyOffer, type LoyaltyState } from "./loyalty";
import { joinAddress } from "./customer-import";
import type { DiscountResult } from "../../shared/campaigns";
import { storeSnapshot, syncPricesFromPos } from "./pos-bridge";
import { notifyOrderStatus } from "./order-messages";

/**
 * Siparişleri POS'a Suitable Dış Kaynak API'siyle yazar (eklenti yerine), durumlarını webhook ve yoklamayla izler.
 * Yazma yöntemi Ayar "pos.writeMode" ("api" | "extension"); API ayarları (env) yoksa her zaman eklenti.
 */

export const WRITE_MODE_KEY = "pos.writeMode";
/** "1" iken siparişler test:true ile gönderilir (puan, ziyaret, kampanya sayaçları ve stok etkilenmez, POS otomatik basmaz; satış raporunda görünür, denemeden sonra iptal edilmeli) */
export const TEST_ORDERS_KEY = "suitable.testOrders";
export type WriteMode = "api" | "extension";

/** Panelden girilen Suitable ayarları (env varsa env öncelikli). Anahtar ve webhook gizlisi gizli bilgidir: yalnız sunucuda tutulur, panele geri verilmez. */
export const CFG_KEYS = { baseUrl: "suitable.baseUrl", apiKey: "suitable.apiKey", webhookSecret: "suitable.webhookSecret", priceMode: "suitable.priceMode", evaluatePayment: "suitable.evaluatePayment" } as const;
export const DEFAULT_BASE_URL = "https://api-suitable-live.web.app/v1";

export async function resolveSuitableCfg(db: PrismaClient, env: SuitableEnv | null): Promise<(SuitableEnv & { source: "env" | "panel" }) | null> {
  const rows = await db.setting.findMany({ where: { key: { in: Object.values(CFG_KEYS) } } });
  const v = (k: string) => rows.find((x) => x.key === k)?.value?.trim() || undefined;
  const apiKey = env?.apiKey ?? v(CFG_KEYS.apiKey);
  if (!apiKey) return null;
  const pm = v(CFG_KEYS.priceMode);
  return {
    baseUrl: (env?.baseUrl ?? v(CFG_KEYS.baseUrl) ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    apiKey,
    webhookSecret: env?.webhookSecret ?? v(CFG_KEYS.webhookSecret) ?? null,
    stores: env?.stores ?? {},
    priceMode: env?.priceMode ?? (pm === "platform" || pm === "server" || pm === "auto" ? pm : "auto"),
    source: env?.apiKey ? "env" : "panel",
  };
}

async function putSetting(db: PrismaClient, key: string, value: string): Promise<void> {
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

const ORDER_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_TRIES = 8;
/** Kampanya sorgusu geçici hatayla bu kadar denemeden sonra kampanyasız yazılır */
const EVALUATE_TRIES = 3;
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
  /** Geçerli ayarlar (env + panel); anahtar yoksa null: API kullanılamaz */
  cfg: (SuitableEnv & { source: "env" | "panel" }) | null = null;
  client: SuitableClient | null = null;
  private readonly menus = new Map<string, { at: number; menu: ApiMenu; etag: string | null }>();
  /** Panel fiyatları POS'a göre değişince katalog eşitlemesini tetikler (sunucu açılışında bağlanır) */
  onPriceChange: (brandId: number) => void = () => undefined;

  constructor(
    private readonly db: PrismaClient,
    private readonly envCfg: SuitableEnv | null,
    private readonly cloud: Messenger | null,
    private readonly publicBaseUrl: string | null,
  ) {}

  /** Ayarları (env + panel) yeniden okur ve istemciyi kurar; menü önbelleği sıfırlanır. */
  async reload(): Promise<void> {
    this.cfg = await resolveSuitableCfg(this.db, this.envCfg);
    this.client = this.cfg ? new SuitableClient({ baseUrl: this.cfg.baseUrl, apiKey: this.cfg.apiKey }) : null;
    this.menus.clear();
  }

  /** Suitable'ın durum bildirimini göndereceği adres (herkese açık https adresi gerekir) */
  webhookUrl(): string | null {
    return this.publicBaseUrl?.startsWith("https://") ? this.publicBaseUrl + "/api/webhooks/suitable" : null;
  }

  configured(): boolean {
    return !!this.cfg;
  }

  private api(): SuitableClient {
    if (!this.client) throw new SuitableApiError(0, "not_configured", "Suitable API anahtarı tanımlı değil");
    return this.client;
  }

  /** Dışarıdan (panel) kullanım için */
  get http(): SuitableClient {
    return this.api();
  }

  priceMode(): PriceMode {
    return this.cfg?.priceMode ?? "auto";
  }

  private storeOf(brand: Pick<Brand, "code" | "posCafeId">): string | null {
    return this.cfg ? storeIdOf(this.cfg, brand) : null;
  }

  async evaluatePaymentOn(): Promise<boolean> {
    return (await this.db.setting.findUnique({ where: { key: CFG_KEYS.evaluatePayment } }))?.value !== "0";
  }

  /** Panelden bağlantı ayarı: anahtar boş bırakılırsa değişmez. */
  async saveConfig(p: { baseUrl?: string; apiKey?: string; priceMode?: PriceMode; evaluatePayment?: boolean }): Promise<void> {
    if (p.evaluatePayment !== undefined) await putSetting(this.db, CFG_KEYS.evaluatePayment, p.evaluatePayment ? "1" : "0");
    if (p.baseUrl !== undefined) await putSetting(this.db, CFG_KEYS.baseUrl, p.baseUrl.trim());
    if (p.apiKey) await putSetting(this.db, CFG_KEYS.apiKey, p.apiKey.trim());
    if (p.priceMode) await putSetting(this.db, CFG_KEYS.priceMode, p.priceMode);
    await this.reload();
  }

  /**
   * Webhook'u bizim adresimize kurar (PUT /v1/webhook). Gizli anahtar yalnız üretildiğinde bir kez döner: panel ayarına yazılır.
   * Daha önce kurulmuş ve anahtarı bilinmiyorsa yenisi üretilir.
   */
  async setupWebhook(): Promise<{ url: string; secretStored: boolean }> {
    if (!this.publicBaseUrl?.startsWith("https://")) throw new SuitableApiError(0, "no_public_url", "Herkese açık https adresi (PUBLIC_BASE_URL) tanımlı değil");
    const url = this.publicBaseUrl + "/api/webhooks/suitable";
    const res = await this.api().putWebhook(url, !this.cfg?.webhookSecret);
    if (res.secret) {
      await putSetting(this.db, CFG_KEYS.webhookSecret, res.secret);
      await this.reload();
    }
    return { url: res.url ?? url, secretStored: !!res.secret };
  }

  async removeWebhook(): Promise<void> {
    await this.api().deleteWebhook();
    await this.db.setting.deleteMany({ where: { key: CFG_KEYS.webhookSecret } });
    await this.reload();
  }

  async menuOf(store: string, now = Date.now()): Promise<ApiMenu> {
    const hit = this.menus.get(store);
    if (hit && now - hit.at < MENU_TTL_MS) return hit.menu;
    // Süre dolunca ETag ile sorulur: değişmediyse gövdesiz 304 (hız sınırını harcamaz)
    const res = await this.api().getMenu(store, hit?.etag);
    if (res.notModified && hit) {
      this.menus.set(store, { ...hit, at: now });
      return hit.menu;
    }
    if (!res.menu) throw new SuitableApiError(502, "empty_menu", "Suitable menüyü boş döndürdü");
    this.menus.set(store, { at: now, menu: res.menu, etag: res.etag });
    return res.menu;
  }

  /**
   * Suitable menüsünü (Dış Kaynak kanal fiyatlarıyla) alır: eşleşme raporu için kaydeder ve panel fiyatlarını POS'a eşitler (çelişkide POS esas).
   * Dönen: değişen ürün sayısı.
   */
  async syncMenus(): Promise<number> {
    const brands = await this.db.brand.findMany({ orderBy: { sortOrder: "asc" } });
    let changed = 0;
    for (const brand of brands) {
      const store = this.storeOf(brand);
      if (!store) continue;
      try {
        const snap = menuToSnapshot(await this.menuOf(store), store);
        if (!snap.products.length) continue;
        await storeSnapshot(this.db, brand.id, snap);
        const prices = await syncPricesFromPos(this.db, brand.id, snap);
        if (prices.products.length || prices.choices) {
          this.onPriceChange(brand.id);
          changed += prices.products.length + prices.choices;
          logger.info({ brand: brand.code, products: prices.products.length, choices: prices.choices }, "Suitable menüsünden fiyatlar eşitlendi");
        }
      } catch (err) {
        logger.warn({ brand: brand.code, err: (err as Error).message }, "Suitable menüsü alınamadı");
      }
    }
    return changed;
  }

  /** Hazır ve henüz POS'a yazılmamış siparişleri API'ye gönderir. Dönen: kaç sipariş yazıldı. */
  async sendPending(now = new Date()): Promise<number> {
    if ((await getWriteMode(this.db, this.cfg)) !== "api") return 0;
    const brands = await this.db.brand.findMany({ orderBy: { sortOrder: "asc" } });
    let sent = 0;
    for (const brand of brands) {
      const store = this.storeOf(brand);
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

  /** POS kampanya değerlendirmesi (hiçbir şey yazılmaz). Hata fırlatır; çağıran karar verir. */
  private async evaluateLines(store: string, phone: string, lines: ApiOrderLine[], timeoutMs: number, paymentLabel = "", selection: ApiSelection | null = null): Promise<ApiEvaluateResult> {
    // Ödeme şekline bağlı kampanyalar (ör. yalnız nakit ve kapıda kart) için ödeme şekli sorguya eklenir; gönderilmezse ödeme kısıtı değerlendirilmez ve kısıtlı kampanyalar da döner
    const payment = paymentLabel && (await this.evaluatePaymentOn()) ? apiPayment(paymentLabel).payment : undefined;
    const sel = selection && hasSelection(selection) ? { ...(selection.couponId ? { couponId: selection.couponId } : {}), ...(selection.pointsToRedeem ? { pointsToRedeem: selection.pointsToRedeem } : {}), ...(selection.giftIds?.length ? { giftIds: selection.giftIds } : {}), ...(selection.giftChoices && Object.keys(selection.giftChoices).length ? { giftChoices: selection.giftChoices } : {}) } : null;
    const call = this.api().evaluate({ store, customer: { phone }, delivery: { type: "delivery" }, lines, ...(payment ? { payment } : {}), ...(sel ? { selection: sel } : {}) });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new SuitableApiError(0, "network", "Kampanya sorgusu zaman aşımına uğradı")), timeoutMs);
    });
    try {
      return await Promise.race([call, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Siparişin POS kampanya indirimi (müşteriyle konuşurken: ödeme seçimi, düzenleme). Kısa zaman aşımı; hata ya da eşleşmeyen ürün olursa null
   * (indirim uygulanmaz, sipariş yazılırken yeniden sorulur).
   */
  async evaluateOrder(orderId: number, timeoutMs = 4000): Promise<DiscountResult | null> {
    try {
      if (this.priceMode() === "server" || !this.cfg) return null; // server: kampanya uygulanmaz
      const order = await this.db.order.findUnique({ where: { id: orderId }, include: { brand: true, customer: true, items: { orderBy: { id: "asc" }, include: { options: { orderBy: { id: "asc" } } } } } });
      if (!order) return null;
      const store = this.storeOf(order.brand);
      const phone = apiPhone(order.customer.waId);
      if (!store || !phone || !order.items.length) return null;
      const snap = menuToSnapshot(await this.menuOf(store), store);
      const built = await buildApiLines(this.db, order, snap);
      if (!built.ok) return null;
      // Müşteri kupon/puan seçtiyse indirim onunla birlikte hesaplanır (platform modu); seçim artık geçersizse düşülür
      const state = this.priceMode() === "platform" ? parseLoyalty(order.loyaltyJson) : null;
      const sel = state && hasSelection(state.sel) ? state.sel : null;
      let ev: ApiEvaluateResult;
      try {
        ev = await this.evaluateLines(store, phone, built.lines, timeoutMs, order.paymentLabel, sel);
      } catch (err) {
        if (sel && err instanceof SuitableApiError && err.code === "loyalty_invalid") {
          await this.dropLoyalty(orderId, `Kupon/puan kullanımı geçersiz çıktı (${err.message.slice(0, 120)}), indirimsiz devam edildi`);
          ev = await this.evaluateLines(store, phone, built.lines, timeoutMs, order.paymentLabel);
        } else throw err;
      }
      const campaign = Math.min(built.subtotalKurus, Math.max(0, Math.round(ev.campaignDiscount * 100)));
      const loyalty = sel ? Math.min(built.subtotalKurus - campaign, Math.max(0, Math.round((ev.loyaltyDiscount ?? 0) * 100))) : 0;
      const names = campaign > 0 ? ev.appliedCampaigns.map((c) => c.name).join(" + ") : "";
      const lnote = sel && state && loyalty > 0 ? selectionSummary({ ...state, pointsUsed: ev.loyalty?.pointsUsed ?? state.sel.pointsToRedeem }) : "";
      return { discountKurus: campaign + loyalty, note: [names, lnote].filter(Boolean).join(" + ").slice(0, 120) };
    } catch (err) {
      logger.warn({ orderId, err: (err as Error).message }, "Suitable kampanya sorgusu yapılamadı");
      return null;
    }
  }

  /** Kupon/puan seçimini siparişten kaldırır (geçersiz çıktığında) ve geçmişe not düşer. */
  private async dropLoyalty(orderId: number, note: string): Promise<void> {
    const o = await this.db.order.findUnique({ where: { id: orderId }, select: { loyaltyJson: true } });
    const st = parseLoyalty(o?.loyaltyJson);
    if (st) await this.db.order.update({ where: { id: orderId }, data: { loyaltyJson: serializeLoyalty({ ...st, sel: {}, discountKurus: 0, pointsUsed: 0 }) } });
    await this.db.orderChange.create({ data: { orderId, text: note.slice(0, 300) } });
  }

  /**
   * Müşterinin siparişte kullanabileceği kupon/puan/hediye hakları (sipariş akışı adres sonrası sorar). Yalnız API yöntemi + platform modu + customers:read;
   * kullanılabilir bir şey yoksa ya da sorgu yapılamazsa null (müşteriye hiçbir şey sorulmaz). Sonuç saklanmaz: yalnız siparişin akışında tutulur.
   */
  async loyaltyOptions(orderId: number, timeoutMs = 4000): Promise<LoyaltyOffer | null> {
    if (!this.cfg || this.priceMode() !== "platform" || Date.now() < this.customersBlockedUntil) return null;
    try {
      if ((await getWriteMode(this.db, this.cfg)) !== "api") return null;
      const order = await this.db.order.findUnique({ where: { id: orderId }, include: { brand: true, customer: true } });
      const store = order ? this.storeOf(order.brand) : null;
      const wa = order?.customer.waId;
      if (!order || !store || !wa) return null;
      const found = await Promise.race([this.api().getCustomer(store, wa), new Promise<null>((_, rej) => setTimeout(() => rej(new Error("zaman aşımı")), timeoutMs).unref?.())]);
      const offer = offerFromCustomer(found);
      return offerIsEmpty(offer) ? null : offer;
    } catch (err) {
      if (err instanceof SuitableApiError && (err.status === 403 || err.status === 401)) this.customersBlockedUntil = Date.now() + 10 * 60_000;
      logger.warn({ orderId, err: (err as Error).message }, "Suitable sadakat seçenekleri alınamadı");
      return null;
    }
  }

  /**
   * Seçimin indirimini Suitable'a sorar (hiçbir şey harcanmaz). Dönen: kampanya + kupon/puan indirimi (kuruş) ve kullanılacak puan;
   * seçim geçersizse (kupon kullanılmış, puan yetersiz...) `ok:false` ve müşteriye söylenecek sebep.
   */
  async loyaltyPreview(orderId: number, sel: ApiSelection, timeoutMs = 6000): Promise<{ ok: true; campaignKurus: number; loyaltyKurus: number; pointsUsed: number } | { ok: false; reason: string }> {
    try {
      const order = await this.db.order.findUnique({ where: { id: orderId }, include: { brand: true, customer: true, items: { orderBy: { id: "asc" }, include: { options: { orderBy: { id: "asc" } } } } } });
      const store = order ? this.storeOf(order.brand) : null;
      const phone = order ? apiPhone(order.customer.waId) : null;
      if (!order || !store || !phone || !order.items.length) return { ok: false, reason: "Şu an hesaplanamadı." };
      const snap = menuToSnapshot(await this.menuOf(store), store);
      const built = await buildApiLines(this.db, order, snap);
      if (!built.ok) return { ok: false, reason: "Şu an hesaplanamadı." };
      const ev = await this.evaluateLines(store, phone, built.lines, timeoutMs, order.paymentLabel, sel);
      const campaignKurus = Math.min(built.subtotalKurus, Math.max(0, Math.round(ev.campaignDiscount * 100)));
      const loyaltyKurus = Math.min(built.subtotalKurus - campaignKurus, Math.max(0, Math.round((ev.loyaltyDiscount ?? 0) * 100)));
      return { ok: true, campaignKurus, loyaltyKurus, pointsUsed: ev.loyalty?.pointsUsed ?? sel.pointsToRedeem ?? 0 };
    } catch (err) {
      const e = err as Error;
      logger.warn({ orderId, err: e.message }, "Suitable kupon/puan önizlemesi yapılamadı");
      if (err instanceof SuitableApiError && err.code === "loyalty_invalid") return { ok: false, reason: "Bu kupon/puan şu an kullanılamıyor." };
      return { ok: false, reason: "Şu an hesaplanamadı." };
    }
  }

  /**
   * Müşteri sorgusu (customers:read): siparişin müşterisini telefonla Suitable'da arar. Kayıtlı adreslerini müşterinin adres listesine ekler
   * (var olanı yinelemez, mevcut adreslerin sırasını bozmaz), boş adını doldurur, sadakat durumunu sipariş geçmişine not düşer.
   * Yalnız API yönteminde çalışır; kısa zaman aşımı, hata ya da yetki yoksa sessizce atlanır (adres sorusu normal sürer). Sonuç saklanmaz.
   */
  async lookupCustomer(orderId: number, timeoutMs = 4000): Promise<ApiCustomer | null> {
    if (!this.cfg || Date.now() < this.customersBlockedUntil) return null;
    try {
      if ((await getWriteMode(this.db, this.cfg)) !== "api") return null;
      const order = await this.db.order.findUnique({ where: { id: orderId }, include: { brand: true, customer: true } });
      if (!order) return null;
      const store = this.storeOf(order.brand);
      const wa = order.customer.waId;
      if (!store || !wa) return null;
      const found = await Promise.race([
        this.api().getCustomer(store, wa),
        new Promise<null>((_, rej) => setTimeout(() => rej(new Error("zaman aşımı")), timeoutMs).unref?.()),
      ]);
      if (!found) return null;
      let added = 0;
      const existing = (await this.db.customerAddress.findMany({ where: { customerId: order.customerId }, select: { key: true } })).map((a) => a.key);
      for (const a of found.addresses ?? []) {
        const text = [joinAddress(a.neighborhood ?? "", a.text ?? "") ?? "", a.detail, a.district && !(a.text ?? "").includes(a.district) ? a.district : "", a.city && !(a.text ?? "").includes(a.city) ? a.city : ""].filter(Boolean).join(", ");
        const key = addressKey(text);
        const base = addressKey(joinAddress(a.neighborhood ?? "", a.text ?? "") ?? "");
        if (!key || !base || existing.some((k) => k.includes(base) || base.includes(k))) continue;
        await this.db.customerAddress.create({ data: { customerId: order.customerId, text: text.trim(), key, lat: a.lat ?? null, lng: a.lng ?? null, lastUsedAt: new Date(0) } });
        existing.push(key);
        added++;
      }
      if (found.name && !order.customer.name?.trim()) await this.db.customer.update({ where: { id: order.customerId }, data: { name: found.name.slice(0, 120) } });
      const l = found.loyalty;
      if (l && (l.points || l.tier || l.stampCards?.length || l.coupons?.length || l.giftRights?.length)) {
        const parts = [
          l.tier ? `seviye ${l.tier}` : "",
          typeof l.points === "number" ? `${l.points} puan` : "",
          l.coupons?.length ? `${l.coupons.length} kupon` : "",
          l.giftRights?.length ? `${l.giftRights.length} hediye hakkı` : "",
          ...(l.stampCards ?? []).map((s) => `${s.name} ${s.progress}/${s.target}`),
        ].filter(Boolean);
        const text = `Suitable müşteri kaydı: ${parts.join(", ")}`;
        if (!(await this.db.orderChange.findFirst({ where: { orderId, text } }))) await this.db.orderChange.create({ data: { orderId, text } });
      }
      if (added) logger.info({ orderId, added }, "Suitable'dan müşteri adresleri eklendi");
      return found;
    } catch (err) {
      const e = err as Error;
      // Anahtarda customers:read yoksa (403) her siparişte boşuna denemeyelim
      if (err instanceof SuitableApiError && (err.status === 403 || err.status === 401)) this.customersBlockedUntil = Date.now() + 10 * 60_000;
      logger.warn({ orderId, err: e.message }, "Suitable müşteri sorgusu yapılamadı");
      return null;
    }
  }

  private customersBlockedUntil = 0;

  private readonly pendingUpdates = new Map<number, NodeJS.Timeout>();

  /**
   * Sepet değişti (personel ürün ekledi/çıkardı ya da müşteri ek sepet gönderdi): POS'a (Suitable API ile) yazılmış siparişin sepeti kısa bir
   * gecikmeyle PATCH ile güncellenir; arka arkaya yapılan değişiklikler tek güncellemede toplanır.
   */
  scheduleOrderUpdate(orderId: number, delayMs = Number(process.env.SUITABLE_UPDATE_DELAY_MS) || 4000): void {
    if (!this.cfg) return;
    const t = this.pendingUpdates.get(orderId);
    if (t) clearTimeout(t);
    const timer = setTimeout(() => {
      this.pendingUpdates.delete(orderId);
      void this.pushOrderUpdate(orderId);
    }, delayMs);
    timer.unref?.();
    this.pendingUpdates.set(orderId, timer);
  }

  /**
   * POS siparişinin sepetini günceller (PATCH /v1/orders/<id>; sepet ve tutarlar baştan gönderilir). Kuryeye çıkmış, iptal edilmiş ya da kupon/puan harcanmış
   * siparişte, menüde karşılığı olmayan üründe ve kalıcı hatalarda değişiklik POS'a yansımaz: sipariş geçmişine ve panel uyarısına "POS'ta elle düzeltin" yazılır.
   * Geçici hatada (ağ, 5xx, hız sınırı) birkaç kez yeniden denenir.
   */
  async pushOrderUpdate(orderId: number, attempt = 1): Promise<void> {
    const manual = async (why: string) => {
      const text = `POS siparişi otomatik güncellenemedi: ${why.slice(0, 200)}. Değişikliği POS'ta elle yapın.`;
      await this.db.orderChange.create({ data: { orderId, text } });
      await setPosAlert(this.db, "api", `Sipariş #${orderId}: ${text}`);
      logger.warn({ orderId, why }, "Suitable sipariş güncellemesi yapılamadı");
    };
    try {
      if (!this.cfg || (await getWriteMode(this.db, this.cfg)) !== "api") return;
      const order = await this.db.order.findUnique({ where: { id: orderId }, include: { brand: true, customer: true, items: { orderBy: { id: "asc" }, include: { options: { orderBy: { id: "asc" } } } } } });
      if (!order || !order.suitableId || !["NEW", "PREPARING"].includes(order.status)) return; // POS'a henüz yazılmamışsa gönderim güncel sepeti zaten yazar
      const store = this.storeOf(order.brand);
      if (!store) return;
      const state = parseLoyalty(order.loyaltyJson);
      if (state && hasSelection(state.sel)) return await manual("sipariş kupon/puan/hediye hakkı kullanıyor (Suitable bu siparişin güncellenmesine izin vermez)");
      const snap = menuToSnapshot(await this.menuOf(store), store);
      const mode = this.priceMode();
      let evaluation: ApiEvaluateResult | null = null;
      if (mode !== "server") {
        const built0 = await buildApiLines(this.db, order, snap);
        if (!built0.ok) return await manual(built0.error);
        evaluation = await this.evaluateLines(store, apiPhone(order.customer.waId) ?? "", built0.lines, 8000, order.paymentLabel);
      }
      const built = await buildApiOrder(this.db, order, snap, store, evaluation, mode, null);
      if (!built.ok) return await manual(built.error);
      const patch = { lines: built.body.lines, ...(built.body.pricing ? { pricing: built.body.pricing } : {}), ...(built.body.campaignIds ? { campaignIds: built.body.campaignIds } : {}), ...(built.body.note ? { note: built.body.note } : {}) };
      await this.api().updateOrder(order.suitableId, patch);
      const campaignKurus = mode === "platform" ? Math.round((built.body.pricing?.campaignDiscount ?? 0) * 100) : order.discountKurus;
      await this.db.order.update({ where: { id: orderId }, data: { discountKurus: campaignKurus, ...(mode === "platform" ? { discountNote: evaluation && campaignKurus > 0 ? evaluation.appliedCampaigns.map((c) => c.name).join(" + ").slice(0, 120) : "" } : {}), addedPending: false } });
      await this.db.orderChange.create({ data: { orderId, text: `POS siparişi güncellendi (${order.posRef ?? "API"}): sepet Suitable'a otomatik yansıdı${built.warnings.length ? ` · uyarı: ${built.warnings.join("; ").slice(0, 200)}` : ""}` } });
      logger.info({ orderId, suitableId: order.suitableId }, "Suitable siparişi güncellendi");
    } catch (err) {
      const e = err as Error | SuitableApiError;
      if (e instanceof SuitableApiError && e.code === "not_updatable") {
        const reason = String(e.details?.reason ?? "");
        const why = reason === "dispatched" ? "sipariş kuryeye çıkmış" : reason === "cancelled" ? "sipariş iptal edilmiş" : reason === "loyalty_spent" ? "kupon/puan harcanmış" : e.message;
        return void (await manual(why));
      }
      if (e instanceof SuitableApiError && e.retryable && attempt < 3) {
        const t = setTimeout(() => void this.pushOrderUpdate(orderId, attempt + 1), attempt * 20_000);
        t.unref?.();
        return;
      }
      await manual(e.message).catch(() => undefined);
    }
  }

  private async fail(orderId: number, err: SuitableApiError | Error, tries: number, now: Date, permanent: boolean): Promise<void> {
    let text = err.message.slice(0, 300);
    // Fiyat/kampanya alanı hatası: çoğunlukla paneldeki fiyat modu ile POS'taki anahtarın modu uyuşmuyordur
    if (err instanceof SuitableApiError && err.code === "validation" && /pricing|campaign|discount|gift|selection|total|subtotal/i.test(JSON.stringify(err.details) + err.message)) {
      text = (text + " (Paneldeki fiyat modu POS'taki anahtarın moduyla aynı mı? Anahtar 'Fiyatı istemci hesaplar' ise panelde 'Fiyatı biz hesaplarız' seçin.)").slice(0, 400);
    }
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
      const lines = await buildApiLines(this.db, order, snap);
      if (!lines.ok) {
        // Menüde karşılığı yok: bekleyince düzelmez, personel elle girer
        await this.fail(order.id, new Error(lines.error), tries, now, true);
        return false;
      }
      // Kampanya POS'ta belirlenir. platform: önce POS'a sorulur, sonuç siparişe yazılır; auto: Suitable sipariş açılırken uygular (sorgu yalnız kampanya adı içindir);
      // server: kampanya yok. Geçici hatada yeniden denenir (kampanya kaybolmasın); birkaç denemeden sonra kampanyasız yazılır.
      const mode = this.priceMode();
      let evaluation: ApiEvaluateResult | null = null;
      let campaignNote = "";
      // Müşterinin seçtiği kupon/puan/hediye hakkı (yalnız platform modu): sipariş açılırken Suitable aynı işlemde harcar (test siparişinde harcanmaz)
      const loyaltyState = mode === "platform" ? parseLoyalty((order as { loyaltyJson?: string | null }).loyaltyJson) : null;
      const selection = loyaltyState && hasSelection(loyaltyState.sel) ? loyaltyState.sel : null;
      if (mode !== "server") {
        try {
          evaluation = await this.evaluateLines(store, apiPhone(order.customer.waId) ?? "", lines.lines, 8000, order.paymentLabel, selection);
        } catch (err) {
          const e = err as SuitableApiError;
          // Kupon/puan bu arada geçersiz olduysa (kullanıldı, puan değişti): seçim düşülür, sipariş indirimsiz (kampanyayla) yeniden denenir
          if (selection && e instanceof SuitableApiError && e.code === "loyalty_invalid") {
            const gone = loyaltyState?.discountKurus ?? 0;
            await this.dropLoyalty(order.id, `Kupon/puan kullanımı geçersiz çıktı (${e.message.slice(0, 120)}); sipariş bu indirim olmadan gönderiliyor`);
            await this.db.order.update({ where: { id: order.id }, data: { discountKurus: Math.max(0, order.discountKurus - gone) } });
            return false;
          }
          if (e instanceof SuitableApiError && e.code === "product_unavailable") {
            await this.fail(order.id, e, tries, now, true);
            return false;
          }
          if (e instanceof SuitableApiError && e.retryable && tries < EVALUATE_TRIES) {
            await this.fail(order.id, e, tries, now, false);
            return false;
          }
          campaignNote = ` · kampanya sorgulanamadı${mode === "platform" ? ", kampanyasız yazıldı" : ""} (${e.message.slice(0, 120)})`;
        }
      }
      const built = await buildApiOrder(this.db, order, snap, store, evaluation, mode, selection);
      if (!built.ok) {
        await this.fail(order.id, new Error(built.error), tries, now, true);
        return false;
      }
      const test = await testOrdersOn(this.db);
      const res = await this.api().createOrder(test ? { ...built.body, test: true } : built.body);
      const ref = res.receiptNo ? `#${res.receiptNo}` : `API ${res.orderId.slice(-6)}`;
      // İndirim POS'un kampanyasıdır: sipariş kaydı ve müşteriye giden mesajlar POS'un tutarıyla aynı olur
      let campaignKurus: number;
      const driftNotes: string[] = [];
      if (mode === "platform") campaignKurus = Math.round((built.body.pricing?.campaignDiscount ?? 0) * 100);
      else if (res.total != null) {
        // Fiyatı ve kampanyayı Suitable hesapladı: ödenecek tutar POS'un toplamıdır
        const posTotal = Math.round(res.total * 100);
        campaignKurus = Math.max(0, Math.min(order.totalKurus, order.totalKurus - posTotal));
        if (posTotal > order.totalKurus) driftNotes.push(`POS toplamı (${(posTotal / 100).toFixed(2)} TL) bizim hesaptan yüksek: fiyatları eşitleyin`);
      } else campaignKurus = Math.round((res.campaignDiscount ?? 0) * 100);
      const names = evaluation?.appliedCampaigns.map((c) => c.name).join(" + ").slice(0, 120) ?? "";
      const campaignName = campaignKurus > 0 ? names || "POS kampanyası" : "";
      // Kupon/puan indirimi: siparişle gönderilen (Suitable'ın hesapladığı) tutar; toplam indirim = kampanya + kupon/puan
      const loyaltyKurus = built.body.selection ? Math.round((built.body.pricing?.loyaltyDiscount ?? 0) * 100) : 0;
      const loyaltyName = loyaltyKurus > 0 && loyaltyState ? selectionSummary({ ...loyaltyState, pointsUsed: evaluation?.loyalty?.pointsUsed ?? loyaltyState.sel.pointsToRedeem }) : "";
      const noteText = [campaignName, loyaltyName].filter(Boolean).join(" + ").slice(0, 120);
      const totalDiscountKurus = campaignKurus + loyaltyKurus;
      await this.db.order.update({
        where: { id: order.id },
        data: {
          suitableId: res.orderId, posRef: ref, posAt: new Date(), suitableError: null, suitableNextAt: null, discountKurus: totalDiscountKurus, discountNote: noteText,
          ...(loyaltyState ? { loyaltyJson: serializeLoyalty({ ...loyaltyState, discountKurus: loyaltyKurus, pointsUsed: evaluation?.loyalty?.pointsUsed ?? loyaltyState.sel.pointsToRedeem ?? 0 }) } : {}),
        },
      });
      const warn = [...driftNotes, ...built.warnings];
      await this.db.orderChange.create({ data: { orderId: order.id, text: `Suitable'a yazıldı: ${ref}${test ? " (TEST siparişi: satış raporunda görünür, işiniz bitince iptal edin)" : ""}${res.duplicate ? " (zaten kayıtlıydı)" : ""}${campaignName ? ` · kampanya: ${campaignName} (-${(campaignKurus / 100).toFixed(2)} TL)` : ""}${loyaltyName ? ` · sadakat: ${loyaltyName} (-${(loyaltyKurus / 100).toFixed(2)} TL${test ? ", test: harcanmadı" : ""})` : ""}${campaignNote}${warn.length ? ` · uyarı: ${warn.join("; ")}`.slice(0, 400) : ""}`.slice(0, 600) } });
      const shownKurus = order.discountKurus;
      await markPosEntered(this.db, this.cloud, this.publicBaseUrl, order.id).catch((err: Error) => logger.warn({ orderId: order.id, err: err.message }, "POS girişi bildirilemedi"));
      // POS'un uyguladığı kampanya müşterinin gördüğünden farklıysa (ör. ödeme şekline bağlı kampanya) müşteriye bildirilir
      if (totalDiscountKurus > 0 && totalDiscountKurus !== shownKurus) {
        const fresh = await this.db.order.findUnique({ where: { id: order.id }, include: { brand: true, customer: true } });
        if (fresh) await notifyOrderStatus(this.db, this.cloud, fresh, "CAMPAIGN_APPLIED", this.publicBaseUrl).catch(() => undefined);
      }
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
    // POS'ta iptal edilen sipariş için müşteriye iptal mesajı gider (panelden iptalde sipariş zaten iptal durumunda olduğundan ikinci mesaj çıkmaz)
    if (event) changed = (await applyPosEvents(this.db, this.cloud, this.publicBaseUrl, [{ id: order.id, event }], { notifyCancel: true })) > 0;
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
      const store = this.storeOf(o.brand);
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
          const res = await this.api().listOrders(store, { since, limit: 100, cursor });
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
            status = (await this.api().getOrder(o.suitableId!)).status;
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
      await this.api().cancelOrder(order.suitableId, reason);
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
    // Menü ve fiyat eşitleme: açılıştan kısa süre sonra, sonra 10 dakikada bir (yalnız API yönteminde)
    const menuMs = Number(process.env.SUITABLE_MENU_SYNC_MS) || 10 * 60_000;
    let menuBusy = false;
    const menuTick = () => {
      if (menuBusy) return;
      menuBusy = true;
      getWriteMode(this.db, this.cfg)
        .then((m) => (m === "api" ? this.syncMenus() : 0))
        .catch((err: Error) => logger.warn({ err: err.message }, "Suitable menü eşitlemesi çalışmadı"))
        .finally(() => {
          menuBusy = false;
        });
    };
    const t3 = setInterval(menuTick, menuMs);
    const first = setTimeout(menuTick, Math.min(20_000, menuMs));
    t1.unref();
    t2.unref();
    t3.unref();
    first.unref();
    return () => {
      clearInterval(t1);
      clearInterval(t2);
      clearInterval(t3);
      clearTimeout(first);
    };
  }
}
