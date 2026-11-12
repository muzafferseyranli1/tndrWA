import { createHmac, timingSafeEqual } from "node:crypto";
import type { Brand, Customer, Order, PrismaClient } from "@prisma/client";
import { availabilityOf, type ProductStatus } from "../../shared/availability";
import { hoursSummary, nextOpeningText, orderingState, type OrderingState } from "../../shared/hours";
import { formatTRY } from "../../shared/money";
import { getHours, getMinBasket } from "./hours";
import { MULTI_SEPARATOR } from "./options";
import { recalc } from "./order-edit";
import { findMergeTarget } from "./order-merge";

// ---------------------------------------------------------------------------
// Mini App kimlik doğrulaması: Telegram, sayfayı açan kullanıcıyı "initData" ile imzalar
// ---------------------------------------------------------------------------
export interface TgWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  is_bot?: boolean;
}
export type InitDataResult = { ok: true; user: TgWebAppUser; authDate: number } | { ok: false; reason: string };

const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;

/**
 * Telegram Mini App imzası: data_check_string (hash dışındaki alanlar, anahtara göre sıralı "k=v" satırları) üzerinden
 * HMAC-SHA256(anahtar = HMAC-SHA256("WebAppData", bot jetonu)). Eski (24 saatten uzun) imza kabul edilmez.
 */
export function validateInitData(initData: string, botToken: string, now = Date.now()): InitDataResult {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return { ok: false, reason: "imza yok" };
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "imza geçersiz" };
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > INIT_DATA_MAX_AGE_SEC || authDate - now / 1000 > 300) return { ok: false, reason: "oturum süresi dolmuş" };
  try {
    const user = JSON.parse(params.get("user") ?? "") as TgWebAppUser;
    if (!user || typeof user.id !== "number" || user.is_bot) return { ok: false, reason: "kullanıcı yok" };
    return { ok: true, user, authDate };
  } catch {
    return { ok: false, reason: "kullanıcı okunamadı" };
  }
}

// ---------------------------------------------------------------------------
// Menü verisi
// ---------------------------------------------------------------------------
export interface AppChoice {
  id: number;
  name: string;
  extraKurus: number;
}
export interface AppGroup {
  id: number;
  name: string;
  required: boolean;
  maxSelect: number;
  choices: AppChoice[];
}
export interface AppVariant {
  id: number;
  label: string | null;
  priceKurus: number;
  groupIds: number[];
}
export interface AppProduct {
  /** Porsiyonları birleştiren anahtar (aynı yemek) */
  key: string;
  name: string;
  description: string;
  image: string | null;
  variants: AppVariant[];
}
export interface AppCategory {
  id: number;
  name: string;
  products: AppProduct[];
}
export interface AppMenu {
  brand: { code: string; name: string };
  state: OrderingState;
  /** Kapalıysa/açılış öncesiyse müşteriye gösterilecek bilgi */
  stateText: string | null;
  minBasketKurus: number;
  /** Ödeme şekline bağlı indirimler (sepet ekranında bilgi olarak gösterilir) */
  discounts: { name: string; percent: number }[];
  groups: Record<number, AppGroup>;
  categories: AppCategory[];
}

export async function buildMenu(db: PrismaClient, brand: Brand, now = new Date()): Promise<AppMenu> {
  const [cfg, minBasketKurus, payments, categories] = await Promise.all([
    getHours(db, brand.code),
    getMinBasket(db, brand.code),
    db.paymentType.findMany({ where: { brandId: brand.id, enabled: true, discountPercent: { gt: 0 } }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    db.category.findMany({
      where: { brandId: brand.id },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      include: {
        products: {
          where: { status: "ACTIVE" },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: { optionGroups: { include: { group: { include: { choices: { where: { enabled: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } } } } } },
        },
      },
    }),
  ]);
  const state = orderingState(cfg, now);
  const groups: Record<number, AppGroup> = {};
  const out: AppCategory[] = [];
  for (const c of categories) {
    const byKey = new Map<string, AppProduct>();
    for (const p of c.products) {
      if (availabilityOf({ status: p.status as ProductStatus, soldOutUntil: p.soldOutUntil }, now) !== "IN_STOCK") continue;
      const groupIds: number[] = [];
      for (const link of p.optionGroups) {
        const g = link.group;
        if (!g.enabled || !g.choices.length) continue;
        groups[g.id] ??= { id: g.id, name: g.name, required: g.required, maxSelect: Math.max(1, g.maxSelect), choices: g.choices.map((x) => ({ id: x.id, name: x.name, extraKurus: x.extraKurus })) };
        groupIds.push(g.id);
      }
      groupIds.sort((a, b) => (groups[a].name < groups[b].name ? -1 : 1));
      const key = p.groupKey ? `g:${p.groupKey}` : `p:${p.id}`;
      const item = byKey.get(key) ?? { key, name: p.name, description: p.description, image: null, variants: [] };
      item.image ??= p.imagePath ? `/uploads/${p.imagePath}` : null;
      item.variants.push({ id: p.id, label: p.variantLabel, priceKurus: p.priceKurus, groupIds });
      byKey.set(key, item);
    }
    const products = [...byKey.values()].map((p) => ({ ...p, variants: p.variants.sort((a, b) => a.priceKurus - b.priceKurus) }));
    if (products.length) out.push({ id: c.id, name: c.name, products });
  }
  return {
    brand: { code: brand.code, name: brand.name },
    state,
    stateText: state === "closed" ? `Şu an kapalıyız (${hoursSummary(cfg)}). Bir sonraki açılış: ${nextOpeningText(cfg, now)}.` : state === "pre" ? `Henüz açılmadık; siparişiniz açılışta (${nextOpeningText(cfg, now)}) hazırlanır.` : null,
    minBasketKurus,
    discounts: payments.map((p) => ({ name: p.name, percent: p.discountPercent })),
    groups,
    categories: out,
  };
}

// ---------------------------------------------------------------------------
// Sipariş oluşturma (fiyatlar sunucuda, güncel menüden hesaplanır; istemcideki tutara güvenilmez)
// ---------------------------------------------------------------------------
export interface OrderLineInput {
  productId: number;
  quantity: number;
  options: { groupId: number; choiceIds: number[] }[];
}
export type TgOrderResult =
  | { status: "created"; order: Order }
  | { status: "duplicate"; orderId: number }
  | { status: "rejected"; reason: "closed" | "minBasket" | "phone" | "empty" | "invalid"; message: string; totalKurus?: number; minKurus?: number };

export const MAX_LINES = 40;
export const MAX_LINE_QUANTITY = 20;

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").trim();

export async function createTelegramOrder(
  db: PrismaClient,
  input: { brand: Brand; customer: Customer; requestId: string; lines: OrderLineInput[]; note?: string; now?: Date },
): Promise<TgOrderResult> {
  const { brand, customer } = input;
  const now = input.now ?? new Date();
  if (!customer.waId) return { status: "rejected", reason: "phone", message: "Siparişiniz için telefon numaranızı paylaşmanız gerekiyor." };
  if (!input.lines.length) return { status: "rejected", reason: "empty", message: "Sepetiniz boş." };
  if (input.lines.length > MAX_LINES) return { status: "rejected", reason: "invalid", message: "Sepette çok fazla kalem var." };

  const waMessageId = `tg:order:${brand.code}:${customer.tgId}:${input.requestId}`;
  const dup = await db.order.findUnique({ where: { waMessageId }, select: { id: true } });
  if (dup) return { status: "duplicate", orderId: dup.id };

  if (orderingState(await getHours(db, brand.code), now) === "closed") return { status: "rejected", reason: "closed", message: "Şu an sipariş alamıyoruz." };

  // Ürünler ve seçenekler güncel kayıttan okunur
  const products = await db.product.findMany({
    where: { brandId: brand.id, id: { in: [...new Set(input.lines.map((l) => l.productId))] } },
    include: { optionGroups: { include: { group: { include: { choices: { where: { enabled: true } } } } } } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const invalid = (message: string): TgOrderResult => ({ status: "rejected", reason: "invalid", message });

  const items: {
    productId: number;
    retailerId: string;
    name: string;
    unitKurus: number;
    extraKurus: number;
    quantity: number;
    optionsWanted: boolean;
    options: { create: { groupId: number; groupName: string; choiceName: string; extraKurus: number; complete: boolean }[] };
  }[] = [];
  let total = 0;
  for (const line of input.lines) {
    const p = byId.get(line.productId);
    if (!p || availabilityOf({ status: p.status as ProductStatus, soldOutUntil: p.soldOutUntil }, now) !== "IN_STOCK") return invalid("Sepetinizdeki bir ürün artık satışta değil. Menüyü yenileyip tekrar deneyin.");
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_LINE_QUANTITY) return invalid(`Adet 1 ile ${MAX_LINE_QUANTITY} arasında olmalı.`);
    const name = p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name;
    const groups = new Map(p.optionGroups.filter((l) => l.group.enabled && l.group.choices.length).map((l) => [l.group.id, l.group]));
    const chosen = new Map<number, number[]>();
    for (const o of line.options) {
      if (chosen.has(o.groupId)) return invalid(`${name}: aynı seçenek grubu iki kez gönderilmiş.`);
      const g = groups.get(o.groupId);
      if (!g) return invalid(`${name}: geçersiz seçenek grubu.`);
      const ids = [...new Set(o.choiceIds)];
      if (ids.length > Math.max(1, g.maxSelect)) return invalid(`${name}: "${g.name}" için en fazla ${Math.max(1, g.maxSelect)} seçim yapabilirsiniz.`);
      if (ids.some((id) => !g.choices.some((c) => c.id === id))) return invalid(`${name}: "${g.name}" içinde geçersiz seçim.`);
      if (ids.length) chosen.set(o.groupId, ids);
    }
    for (const g of groups.values()) if (g.required && !chosen.has(g.id)) return invalid(`${name}: "${g.name}" seçimi zorunlu.`);

    let extra = 0;
    const options = [...chosen.entries()].map(([groupId, ids]) => {
      const g = groups.get(groupId)!;
      const picked = g.choices.filter((c) => ids.includes(c.id));
      const sum = picked.reduce((s, c) => s + c.extraKurus, 0);
      extra += sum;
      return { groupId, groupName: g.name, choiceName: picked.map((c) => c.name).join(MULTI_SEPARATOR), extraKurus: sum, complete: true };
    });
    total += (p.priceKurus + extra) * line.quantity;
    // optionsWanted=false: isteğe bağlı gruplar için sohbette "değişiklik ister misiniz?" tekrar sorulmaz (seçimler Mini App'te yapıldı)
    items.push({ productId: p.id, retailerId: p.retailerId, name, unitKurus: p.priceKurus, extraKurus: extra, quantity: line.quantity, optionsWanted: false, options: { create: options } });
  }

  const minKurus = await getMinBasket(db, brand.code);
  if (minKurus > 0 && total < minKurus && !(await findMergeTarget(db, brand.id, customer.id, null, now, "telegram"))) {
    return { status: "rejected", reason: "minBasket", message: `Minimum sepet tutarı ${formatTRY(minKurus)}.`, totalKurus: total, minKurus };
  }

  try {
    const order = await db.$transaction(async (tx) => {
      const created = await tx.order.create({
        // Seçenekler Mini App'te seçildi: sohbet ödeme sorusundan devam eder (KVKK onayı ve açık siparişe ekleme soruları yine sorulur)
        data: { brandId: brand.id, customerId: customer.id, channel: "telegram", waMessageId, stage: "AWAITING_OPTIONS", note: clean(input.note ?? "").slice(0, 300), totalKurus: total, items: { create: items } },
      });
      await tx.message.create({
        data: { brandId: brand.id, customerId: customer.id, direction: "IN", type: "order", body: `Sipariş #${created.id} · ${formatTRY(total)}`, waMessageId: `${waMessageId}:msg`, status: "RECEIVED", orderId: created.id, channel: "telegram" },
      });
      return created;
    });
    await recalc(db, order.id);
    return { status: "created", order: (await db.order.findUnique({ where: { id: order.id } })) ?? order };
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      const again = await db.order.findUnique({ where: { waMessageId }, select: { id: true } });
      if (again) return { status: "duplicate", orderId: again.id };
    }
    throw err;
  }
}
