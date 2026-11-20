import type { PrismaClient } from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PriceMode } from "../lib/env";
import { findPosProduct, groupMatches, matchChoice, optNorm, posPayment, type OrderWithItems, type PosSnapshotData } from "./pos-map";

/**
 * Suitable Dış Kaynak API (v1) istemcisi ve sipariş çevirisi.
 * Fiyatı biz hesaplarız (platform modu): satırların birim fiyatı, seçenek fiyatları, indirim ve toplam olduğu gibi kaydedilir;
 * pricing.subtotal satırların toplamına, pricing.total = subtotal - discount (+ campaignDiscount/loyaltyDiscount çıkarılır) eşit olmalıdır.
 */

export class SuitableApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
  }
  /** Yeniden denenebilir mi: ağ hatası, sunucu hatası, hız sınırı, işletme şimdilik kapalı. Diğer 4xx hatalar kalıcıdır (personel elle girer). */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429 || this.code === "store_closed";
  }
}

export interface ApiMenuOptionItem { id: string; name: string; price: number }
export interface ApiMenuOptionGroup { id: string; name: string; min?: number | null; max?: number | null; items: ApiMenuOptionItem[] }
export interface ApiMenuProduct {
  id: string;
  name: string;
  description?: string;
  image?: string | null;
  active?: boolean;
  inStock?: boolean;
  price?: number;
  variants?: { id: string; name: string; price: number }[];
  optionGroups?: ApiMenuOptionGroup[];
}
export interface ApiMenu {
  store?: { id?: string; name?: string; availability?: { delivery?: { open?: boolean; reason?: string }; pickup?: { open?: boolean; reason?: string } } };
  categories?: { id: string; name: string; active?: boolean; products?: ApiMenuProduct[] }[];
  combos?: unknown[];
  generatedAt?: string;
}

export interface ApiOrderLine {
  productId: string;
  variantId?: string;
  quantity: number;
  unitPrice: number;
  options?: { itemId: string; price: number; count?: number }[];
  note?: string;
  /** Kampanya hediyesi (yalnız platform modu): unitPrice 0, seçenek yok, pricing.subtotal hesabına girmez */
  gift?: boolean;
  campaignId?: string;
}

export interface ApiOrderBody {
  externalId: string;
  store: string;
  channel?: string;
  test?: boolean;
  customer: { name: string; phone: string };
  delivery: { type: "delivery" | "pickup"; address?: { text: string; lat?: number; lng?: number } };
  lines: ApiOrderLine[];
  payment: { method: "cash" | "card_on_delivery" | "meal_card"; provider?: string };
  pricing?: { subtotal: number; discount?: { amount: number; label?: string }; campaignDiscount?: number; loyaltyDiscount?: number; deliveryFee?: number; total: number };
  campaignIds?: string[];
  loyalty?: { couponCode?: string; pointsRedeemed?: number; giftCampaign?: string };
  /** Kupon/puan/hediye hakkı harcaması (loyalty:redeem); sipariş açılırken aynı işlemde harcanır, iptalde iade edilir */
  selection?: ApiSelection;
  note?: string;
}

export interface ApiOrderResult {
  orderId: string;
  externalId?: string;
  receiptNo: string | null;
  status: string;
  total?: number;
  campaignDiscount?: number;
  duplicate?: boolean;
}

export interface ApiOrderStatus {
  orderId: string;
  externalId?: string;
  receiptNo?: string | null;
  status: string;
  statusCode?: number;
  total?: number;
}

export interface ApiStoreInfo {
  id: string;
  name: string | null;
  availability?: { delivery?: { open?: boolean; reason?: string | null }; pickup?: { open?: boolean; reason?: string | null } };
}

export interface ApiOrderList {
  orders: ApiOrderStatus[];
  nextCursor: string | null;
}

export interface ApiWebhookConfig {
  url: string | null;
  configured: boolean;
  lastAttemptAt?: number | null;
  lastDeliveredAt?: number | null;
  lastStatusCode?: number | null;
  lastError?: string | null;
  lastTest?: { at: number; ok: boolean; statusCode?: number | null; error?: string | null } | null;
}

/** Müşterinin sepete uyguladığı kupon / puan / hediye hakkı (loyalty:redeem kapsamı gerekir); evaluate'te önizlenir, siparişte aynen gönderilir. */
export interface ApiSelection {
  campaignIds?: string[];
  couponId?: string;
  pointsToRedeem?: number;
  giftIds?: string[];
  giftChoices?: Record<string, string>;
}

export interface ApiEvaluateResult {
  subtotal: number;
  /** Kupon + puan indirimi (selection verildiyse); siparişteki pricing.loyaltyDiscount bununla aynı olmalıdır */
  loyaltyDiscount?: number;
  loyalty?: { couponDiscount?: number; pointsDiscount?: number; pointsUsed?: number } | null;
  campaignDiscount: number;
  appliedCampaigns: { id: string; name: string; discount: number }[];
  /** true ise aynı sonuç sipariş açılırken Suitable tarafından uygulanır (kampanyayı sunucunun uyguladığı anahtar): kampanya alanları gönderilmez */
  appliedByServer?: boolean;
  /** Karşılaştırılan POS ödeme anahtarı (cash, card, edenred...); payment verilmediyse null */
  paymentKey?: string | null;
  optionalCampaigns: { id: string; name: string; description?: string; blocked?: boolean; previewDiscount?: number; gifts?: unknown[] }[];
  gifts: { productId: string; name: string; count: number; campaignId?: string }[];
  discountedSubtotal: number;
  warnings: string[];
}

/** GET /v1/customers: telefonla tek müşteri (kayıtlı adresler en çok 10, sadakat cüzdanı). Anahtarda customers:read gerekir. */
export interface ApiCustomer {
  name?: string;
  phone?: string;
  orderCount?: number;
  addresses?: { title?: string; text?: string; neighborhood?: string; district?: string; city?: string; detail?: string; lat?: number | null; lng?: number | null }[];
  loyalty?: {
    points?: number;
    redeemablePoints?: number;
    pointValue?: number;
    tier?: string | null;
    coupons?: { id: string; name: string; type: string; percent?: number; maxAmount?: number; amount?: number; validTo?: string; selectable?: boolean }[];
    giftRights?: { id: string; name: string; items?: { name: string; qty: number }[]; selectable?: boolean }[];
    stampCards?: { campaignId: string; name: string; type: string; label?: string; target: number; progress: number; completedCycles?: number }[];
  } | null;
}

export class SuitableClient {
  constructor(
    private readonly cfg: { baseUrl: string; apiKey: string },
    private readonly fetchFn: typeof fetch = fetch,
    private readonly timeoutMs = 15_000,
  ) {}

  private async requestFull<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<{ status: number; json: T | null; headers: Headers }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new SuitableApiError(0, "network", ctrl.signal.aborted ? "Suitable yanıt vermedi (zaman aşımı)" : `Suitable'a ulaşılamadı: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 304) return { status: 304, json: null, headers: res.headers };
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* gövde JSON değil */
    }
    if (!res.ok) {
      const e = (json as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error;
      const retry = Number(res.headers.get("retry-after"));
      throw new SuitableApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? `Suitable ${res.status} döndü`, e?.details ?? {}, Number.isFinite(retry) && retry > 0 ? retry : null);
    }
    return { status: res.status, json: json as T, headers: res.headers };
  }

  private async request<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
    return (await this.requestFull<T>(method, path, body)).json as T;
  }

  /** Menü; önceki ETag verilirse (ifNoneMatch sorgu parametresiyle) değişmediyse gövdesiz 304: notModified true. */
  async getMenu(store: string, etag?: string | null): Promise<{ menu: ApiMenu | null; etag: string | null; notModified: boolean }> {
    const q = `/menu?store=${encodeURIComponent(store)}${etag ? `&ifNoneMatch=${encodeURIComponent(etag)}` : ""}`;
    const res = await this.requestFull<ApiMenu>("GET", q);
    return { menu: res.json, etag: res.headers.get("etag") ?? etag ?? null, notModified: res.status === 304 };
  }
  listStores(): Promise<{ stores: ApiStoreInfo[] }> {
    return this.request("GET", "/stores");
  }
  listOrders(store: string, o: { since?: string; status?: string; limit?: number; cursor?: string } = {}): Promise<ApiOrderList> {
    const q = new URLSearchParams({ store });
    if (o.since) q.set("since", o.since);
    if (o.status) q.set("status", o.status);
    if (o.limit) q.set("limit", String(o.limit));
    if (o.cursor) q.set("cursor", o.cursor);
    return this.request("GET", `/orders?${q.toString()}`);
  }
  /** Telefonla tek müşteri; işletmede kayıtlı değilse (404) null. Telefon 905XXXXXXXXX ya da +90… olabilir. */
  async getCustomer(store: string, phone: string): Promise<ApiCustomer | null> {
    const digits = phone.replace(/\D/g, "");
    const q = new URLSearchParams({ store, phone: digits.startsWith("0") ? digits : `+${digits}` });
    try {
      return await this.request<ApiCustomer>("GET", `/customers?${q.toString()}`);
    } catch (err) {
      if (err instanceof SuitableApiError && err.status === 404) return null;
      throw err;
    }
  }
  createOrder(body: ApiOrderBody): Promise<ApiOrderResult> {
    return this.request("POST", "/orders", body);
  }
  getOrder(orderId: string): Promise<ApiOrderStatus> {
    return this.request("GET", `/orders/${encodeURIComponent(orderId)}`);
  }
  cancelOrder(orderId: string, reason?: string): Promise<ApiOrderStatus> {
    return this.request("POST", `/orders/${encodeURIComponent(orderId)}/cancel`, reason ? { reason: reason.slice(0, 200) } : {});
  }
  getWebhook(): Promise<ApiWebhookConfig> {
    return this.request("GET", "/webhook");
  }
  /** Gizli anahtar yoksa ya da rotateSecret true ise yenisi üretilir ve yalnız bu yanıtta secret olarak döner */
  putWebhook(url: string, rotateSecret: boolean): Promise<{ url: string; secret?: string; secretRotated?: boolean }> {
    return this.request("PUT", "/webhook", { url, rotateSecret });
  }
  deleteWebhook(): Promise<{ url: string | null }> {
    return this.request("DELETE", "/webhook");
  }
  testWebhook(): Promise<{ ok: boolean; statusCode: number | null; error: string | null }> {
    return this.request("POST", "/webhook/test", {});
  }
  evaluate(body: { store: string; customer?: { phone: string }; delivery: { type: "delivery" | "pickup" }; lines: ApiOrderLine[]; selection?: ApiSelection; payment?: ApiOrderBody["payment"] }): Promise<ApiEvaluateResult> {
    return this.request("POST", "/orders/evaluate", body);
  }
}

/** API menüsünü POS anlık görüntüsü biçimine çevirir (adla eşleştirme mantığı aynı kalır; kimlikler sipariş yazarken kullanılır). Kombolar atlanır. */
export function menuToSnapshot(menu: ApiMenu, storeId: string): PosSnapshotData {
  const products: PosSnapshotData["products"] = [];
  for (const c of menu.categories ?? []) {
    for (const p of c.products ?? []) {
      const variants = (p.variants ?? []).map((v) => ({ id: v.id, name: v.name, price: v.price }));
      products.push({
        id: p.id,
        name: p.name,
        category: c.name,
        sku: null,
        active: p.active !== false && p.inStock !== false && c.active !== false,
        price: p.price ?? variants[0]?.price ?? 0,
        variants,
        options: (p.optionGroups ?? []).map((g) => ({
          id: g.id,
          name: g.name,
          min: Math.max(0, g.min ?? 0),
          max: g.max == null ? 99 : Math.max(0, g.max),
          items: (g.items ?? []).map((i) => ({ id: i.id, name: i.name, price: i.price })),
        })),
      });
    }
  }
  return { cafeId: storeId, cafeName: menu.store?.name ?? "", products };
}

const PROVIDERS: [RegExp, string][] = [
  [/edenred|ticket/, "edenred"],
  [/multinet/, "multinet"],
  [/pluxee|sodexo/, "pluxee"],
  [/setcard/, "setcard"],
  [/metropol/, "metropol"],
];

/** Panel ödeme şeklini API ödeme yöntemine çevirir. Tanınmayan şekil kapıda kart sayılır (uyarı döner). */
export function apiPayment(label: string): { payment: ApiOrderBody["payment"]; warning: string | null } {
  // Yemek kartı: sağlayıcı adı ya da "yemek" geçiyorsa (örn. "Yemek kartı", "Yemek çeki (Multinet)")
  const lower = label.toLocaleLowerCase("tr");
  const provider0 = PROVIDERS.find(([re]) => re.test(lower))?.[1];
  if (provider0 || /yemek/.test(lower)) return { payment: provider0 ? { method: "meal_card", provider: provider0 } : { method: "meal_card" }, warning: null };
  const p = posPayment(label);
  if (p.button === "Nakit") return { payment: { method: "cash" }, warning: null };
  if (p.button === "Kredi Kartı") return { payment: { method: "card_on_delivery" }, warning: null };
  if (p.button === "Yemek Çeki") {
    const l = `${p.sub ?? ""} ${label}`.toLocaleLowerCase("tr");
    const provider = PROVIDERS.find(([re]) => re.test(l))?.[1];
    return { payment: provider ? { method: "meal_card", provider } : { method: "meal_card" }, warning: null };
  }
  return { payment: { method: "card_on_delivery" }, warning: `Ödeme şekli "${label}" API'de karşılığı yok, kapıda kart olarak yazıldı` };
}

/** +90... biçimine: 905551234567 -> +905551234567 */
export function apiPhone(waId: string | null | undefined): string | null {
  const digits = (waId ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? `+${digits}` : null;
}

const tl = (kurus: number) => Math.round(kurus) / 100;

export type OrderLike = OrderWithItems & { channel?: string };
export type LinesResult = { ok: true; lines: ApiOrderLine[]; warnings: string[]; subtotalKurus: number } | { ok: false; error: string };
export type BuildResult = { ok: true; body: ApiOrderBody; warnings: string[] } | { ok: false; error: string };

/**
 * Sipariş satırlarını API satırlarına çevirir (ürün/porsiyon/seçenek kimlikleri POS menüsünden). POS menüsünde karşılığı olmayan
 * ürün/porsiyon hata döner; karşılığı olmayan seçenekler birim fiyata eklenir ve satır notuna yazılır, böylece toplam bozulmaz.
 */
export async function buildApiLines(db: PrismaClient, order: OrderLike, snap: PosSnapshotData): Promise<LinesResult> {
  const warnings: string[] = [];
  const productIds = order.items.map((i) => i.productId).filter((x): x is number => x !== null);
  const products = productIds.length ? await db.product.findMany({ where: { id: { in: productIds } }, include: { optionGroups: { include: { group: { include: { choices: true } } } } } }) : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines: ApiOrderLine[] = [];
  for (const item of order.items) {
    const p = item.productId !== null ? byId.get(item.productId) : undefined;
    if (!p) return { ok: false, error: `"${item.name}" panelde artık yok, POS ürünü bulunamadı` };
    const found = findPosProduct(snap.products, p);
    if ("error" in found) return { ok: false, error: found.error === "noProduct" ? `"${item.name}" POS menüsünde bulunamadı` : `"${item.name}" için POS'ta porsiyon bulunamadı (${p.variantLabel ?? "-"})` };
    const pos = found.product;
    const variant = pos.variants.length ? pos.variants.find((v) => v.name === found.variant) ?? null : null;
    if (pos.variants.length && !variant?.id) return { ok: false, error: `"${item.name}" için POS porsiyon kimliği alınamadı` };

    const options: NonNullable<ApiOrderLine["options"]> = [];
    const notes: string[] = [];
    let matchedKurus = 0;
    for (const a of item.options.filter((o) => o.choiceName)) {
      const panelGroup = p.optionGroups.map((l) => l.group).find((g) => (a.groupId !== null ? g.id === a.groupId : g.name === a.groupName));
      const pg = pos.options.find((o) => (panelGroup ? groupMatches(panelGroup, o) : optNorm(o.name) === optNorm(a.groupName)));
      const picked = a.choiceName.split(" + ").map((x) => x.trim()).filter(Boolean);
      for (const choice of picked) {
        const panelChoice = panelGroup?.choices.find((c) => c.name === choice);
        const hit = pg ? matchChoice(panelChoice ?? { name: choice, posName: null }, pg.items) : undefined;
        const price = picked.length === 1 ? (a as { extraKurus?: number }).extraKurus ?? panelChoice?.extraKurus ?? 0 : panelChoice?.extraKurus ?? 0;
        const hitItem = hit ? pg!.items.find((i) => i.name === hit.name) : undefined;
        if (hitItem?.id) {
          options.push({ itemId: hitItem.id, price: tl(price) });
          matchedKurus += price;
        } else {
          notes.push(`${a.groupName}: ${choice}`);
          warnings.push(`"${item.name}": "${a.groupName}: ${choice}" POS'ta bulunamadı, nota yazıldı`);
        }
      }
    }
    // Karşılığı bulunamayan seçeneklerin ücreti birim fiyatta kalır: satır toplamı bizim hesapla aynı olur
    const unitKurus = Math.max(0, item.unitKurus + item.extraKurus - matchedKurus);
    lines.push({
      productId: pos.id,
      ...(variant?.id ? { variantId: variant.id } : {}),
      quantity: item.quantity,
      unitPrice: tl(unitKurus),
      ...(options.length ? { options } : {}),
      ...(notes.length ? { note: notes.join(", ").slice(0, 200) } : {}),
    });
  }
  const subtotalKurus = order.items.reduce((n, i) => n + i.quantity * (i.unitKurus + i.extraKurus), 0);
  if (subtotalKurus !== order.totalKurus) warnings.push(`Satır toplamı (${tl(subtotalKurus)}) sipariş toplamından (${tl(order.totalKurus)}) farklı, satır toplamı gönderildi`);
  return { ok: true, lines, warnings, subtotalKurus };
}

/**
 * Siparişi API gövdesine çevirir. İndirim ve kampanya POS'tan gelir: `evaluation` (POS kampanya değerlendirmesi) verilirse
 * campaignDiscount, campaignIds ve hediye satırları bundan yazılır; verilmezse indirimsiz gönderilir. Panelde tanımlı ödeme
 * şekli indirimi API yönteminde kullanılmaz (kampanyalar POS'ta tanımlıdır).
 */
export async function buildApiOrder(db: PrismaClient, order: OrderLike, snap: PosSnapshotData, storeId: string, evaluation: ApiEvaluateResult | null = null, mode: PriceMode = "platform", selection: ApiSelection | null = null): Promise<BuildResult> {
  const phone = apiPhone(order.customer.waId);
  if (!phone) return { ok: false, error: "Müşterinin telefon numarası yok (API için zorunlu)" };
  if (!order.address.trim()) return { ok: false, error: "Teslimat adresi yok" };
  const built = await buildApiLines(db, order, snap);
  if (!built.ok) return built;
  const warnings = [...built.warnings];
  const lines = [...built.lines];

  // Yalnız platform modunda kampanya alanları ve hediye satırları biz göndeririz; server/auto modlarında fiyat ve kampanyayı Suitable hesaplar
  const platform = mode === "platform";
  const campaignKurus = evaluation && platform ? Math.min(built.subtotalKurus, Math.max(0, Math.round(evaluation.campaignDiscount * 100))) : 0;
  const campaignIds = evaluation && platform ? evaluation.appliedCampaigns.map((c) => c.id).slice(0, 20) : [];
  // Kupon/puan/hediye hakkı: yalnız platform modunda ve evaluate sonucu varsa; indirim evaluate'in loyaltyDiscount'uyla aynı olmalı (yoksa 409 price_mismatch)
  const sel: ApiSelection | null = selection && platform && evaluation ? { ...(selection.couponId ? { couponId: selection.couponId } : {}), ...(selection.pointsToRedeem ? { pointsToRedeem: selection.pointsToRedeem } : {}), ...(selection.giftIds?.length ? { giftIds: selection.giftIds } : {}), ...(selection.giftChoices && Object.keys(selection.giftChoices).length ? { giftChoices: selection.giftChoices } : {}) } : null;
  const loyaltyKurus = sel && evaluation ? Math.min(built.subtotalKurus - campaignKurus, Math.max(0, Math.round((evaluation.loyaltyDiscount ?? 0) * 100))) : 0;
  // Hediye ürünler fiyatsız satır olarak eklenir; porsiyonluysa ilk porsiyon seçilir
  for (const g of platform ? evaluation?.gifts ?? [] : []) {
    const pos = snap.products.find((x) => x.id === g.productId);
    if (!pos) {
      warnings.push(`Hediye ürün "${g.name}" POS menüsünde bulunamadı, siparişe eklenmedi`);
      continue;
    }
    const v = pos.variants[0];
    lines.push({ productId: pos.id, ...(v?.id ? { variantId: v.id } : {}), quantity: Math.max(1, g.count), gift: true, unitPrice: 0, ...(g.campaignId ? { campaignId: g.campaignId } : {}) });
  }

  const pay = apiPayment(order.paymentLabel);
  if (pay.warning) warnings.push(pay.warning);
  const note = [`WA#${order.id}`, order.paymentLabel, order.note].filter((x) => x && x.trim()).join(" · ").slice(0, 500);

  const body: ApiOrderBody = {
    externalId: `yrndwa-${order.id}`,
    store: storeId,
    channel: order.channel === "telegram" ? "telegram" : "whatsapp",
    customer: { name: (order.customer.name ?? "").trim() || "Müşteri", phone },
    delivery: { type: "delivery", address: { text: order.address.slice(0, 500), ...(order.lat !== null && order.lng !== null ? { lat: order.lat, lng: order.lng } : {}) } },
    lines,
    payment: pay.payment,
    ...(platform
      ? {
          pricing: {
            subtotal: tl(built.subtotalKurus),
            ...(campaignKurus > 0 ? { campaignDiscount: tl(campaignKurus) } : {}),
            ...(sel ? { loyaltyDiscount: tl(loyaltyKurus) } : {}),
            total: tl(built.subtotalKurus - campaignKurus - loyaltyKurus),
          },
        }
      : {}),
    ...(campaignKurus > 0 && campaignIds.length ? { campaignIds } : {}),
    ...(sel ? { selection: sel } : {}),
    ...(note ? { note } : {}),
  };
  return { ok: true, body, warnings };
}

/** Webhook imzası: "sha256=" + HMAC_SHA256(gizli, timestamp + "." + hamGövde). Zaman damgası 5 dakikadan eskiyse reddedilir. */
export function verifySuitableSignature(secret: string, timestamp: string | undefined, rawBody: string | Buffer, header: string | undefined, nowSec = Math.floor(Date.now() / 1000)): "ok" | "bad_signature" | "stale" {
  if (!timestamp || !header) return "bad_signature";
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return "bad_signature";
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex")}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "bad_signature";
  return Math.abs(nowSec - ts) > 300 ? "stale" : "ok";
}
