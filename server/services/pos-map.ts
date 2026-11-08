import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { formatTRY } from "../../shared/money";
import { MAX_CHOICES } from "./options";

/**
 * Suitable POS köprüsü: eklentinin POS'tan okuduğu menü (anlık görüntü) ile paneldeki ürünleri eşleştirir,
 * POS'ta zorunlu olup WhatsApp'ta sorulmayan seçenekleri bulur ve siparişleri POS'a yazılacak biçime çevirir.
 * Eşleşme adlarla yapılır: ürün adı (kasa adı = sourceKey "rms:<ad>", yoksa panel adı), porsiyon adı, seçenek grubu ve seçim adı.
 */

const name = z.string().trim().min(1).max(200);
const price = z.number().finite().min(0).max(1_000_000);

export const posSnapshotSchema = z.object({
  cafeId: z.string().trim().min(1).max(100),
  cafeName: z.string().trim().max(200).default(""),
  products: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(100),
        name,
        category: z.string().trim().max(200).default(""),
        sku: z.string().trim().max(100).nullable().default(null),
        active: z.boolean().default(true),
        price: price.default(0),
        variants: z.array(z.object({ name: z.string().trim().max(100), price: price.default(0) })).max(50).default([]),
        options: z
          .array(
            z.object({
              name,
              min: z.number().int().min(0).max(99).default(0),
              max: z.number().int().min(0).max(99).default(1),
              items: z.array(z.object({ name, price: price.default(0) })).max(200).default([]),
            }),
          )
          .max(50)
          .default([]),
      }),
    )
    .max(5000),
});
export type PosSnapshotData = z.infer<typeof posSnapshotSchema>;
export type PosProduct = PosSnapshotData["products"][number];
export type PosOptionGroup = PosProduct["options"][number];

/** Eşleştirme için: Türkçe küçük harf, harf/rakam dışı tek boşluk. */
export const posNorm = (s: string | null | undefined) =>
  (s ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[^a-z0-9çğıöşü]+/g, " ")
    .trim();

/** Porsiyon adı: "1 Porsiyon" ↔ "1P" ↔ "1 Pors.", "1,5 Porsiyon" ↔ "15P" ↔ "1,5 Pors.", "100 g" ↔ "100 gr". */
export const portionNorm = (s: string | null | undefined) =>
  (s ?? "")
    .toLocaleLowerCase("tr")
    .replace(/pors(iyon)?/g, "p")
    .replace(/gr\b/g, "g")
    .replace(/[^a-z0-9çğıöşü]+/g, "");

const STANDARD_VARIANTS = new Set(["", "standart", "tek", "normal"]);

/** Panel ürününün POS'taki karşılığı: ürün ve (birden çok porsiyon varsa) porsiyon. */
export function findPosProduct(products: PosProduct[], p: { name: string; sourceKey: string | null; variantLabel: string | null }): { product: PosProduct; variant: string | null } | { error: "noProduct" | "noVariant"; product?: PosProduct } {
  const wanted = [p.sourceKey?.startsWith("rms:") ? p.sourceKey.slice(4) : null, p.name].filter((x): x is string => !!x).map(posNorm);
  const candidates = products.filter((x) => wanted.includes(posNorm(x.name)));
  const product = candidates.find((x) => x.active) ?? candidates[0];
  if (!product) return { error: "noProduct" };
  const variants = product.variants;
  if (variants.length <= 1) {
    // Tek porsiyonlu ürün: panelde etiket olsa da (ör. "1 Porsiyon") POS'ta seçilecek porsiyon yok
    if (!p.variantLabel || variants.length === 0 || portionNorm(variants[0].name) === portionNorm(p.variantLabel) || STANDARD_VARIANTS.has(portionNorm(variants[0].name))) return { product, variant: variants[0]?.name ?? null };
    return { error: "noVariant", product };
  }
  const label = portionNorm(p.variantLabel);
  // Panelde porsiyon belirtilmemişse POS'un standart porsiyonu, yoksa "1 Porsiyon"u seçilir
  const variant = label ? variants.find((v) => portionNorm(v.name) === label) : (variants.find((v) => STANDARD_VARIANTS.has(portionNorm(v.name))) ?? variants.find((v) => portionNorm(v.name) === "1p"));
  return variant ? { product, variant: variant.name } : { error: "noVariant", product };
}

export interface MapIssue {
  productId: number;
  product: string;
  kind: "noProduct" | "noVariant" | "requiredMissing" | "groupNotInPos" | "choiceNotInPos" | "tooManyChoices";
  detail: string;
  /** requiredMissing: WhatsApp'a eklenebilecek POS grubu */
  posGroup?: { name: string; min: number; max: number; choices: number };
}

export interface MapReport {
  snapshotAt: string | null;
  cafeName: string;
  posProducts: number;
  checked: number;
  ok: number;
  issues: MapIssue[];
}

type PanelGroup = { id: number; name: string; posName: string | null; required: boolean; enabled: boolean; choices: { name: string; posName: string | null; enabled: boolean }[] };

const groupMatches = (g: { name: string; posName: string | null }, pos: PosOptionGroup) => posNorm(g.posName ?? g.name) === posNorm(pos.name) || posNorm(g.name) === posNorm(pos.name);
const choiceMatches = (c: { name: string; posName: string | null }, item: { name: string }) => posNorm(c.posName ?? c.name) === posNorm(item.name) || posNorm(c.name) === posNorm(item.name);

export async function latestSnapshot(db: PrismaClient, brandId: number): Promise<{ data: PosSnapshotData; createdAt: Date } | null> {
  const row = await db.posSnapshot.findFirst({ where: { brandId }, orderBy: { id: "desc" } });
  if (!row) return null;
  return { data: JSON.parse(row.data) as PosSnapshotData, createdAt: row.createdAt };
}

/** Aktif panel ürünlerini POS menüsüyle karşılaştırır. */
export async function mapReport(db: PrismaClient, brandId: number): Promise<MapReport> {
  const snap = await latestSnapshot(db, brandId);
  const products = await db.product.findMany({
    where: { brandId, status: "ACTIVE" },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { id: "asc" }],
    include: { optionGroups: { include: { group: { include: { choices: true } } } } },
  });
  const report: MapReport = { snapshotAt: snap?.createdAt.toISOString() ?? null, cafeName: snap?.data.cafeName ?? "", posProducts: snap?.data.products.length ?? 0, checked: products.length, ok: 0, issues: [] };
  if (!snap) return report;
  for (const p of products) {
    const label = p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name;
    const issues: MapIssue[] = [];
    const found = findPosProduct(snap.data.products, p);
    if ("error" in found) {
      issues.push({ productId: p.id, product: label, kind: found.error, detail: found.error === "noProduct" ? "POS'ta bu adla ürün yok" : `POS'ta bu porsiyon yok (POS porsiyonları: ${found.product?.variants.map((v) => v.name).join(", ") || "-"})` });
    } else {
      const groups: PanelGroup[] = p.optionGroups.map((l) => l.group).filter((g) => g.enabled);
      for (const pg of found.product.options) {
        if (pg.min < 1) continue;
        if (!groups.some((g) => groupMatches(g, pg))) {
          issues.push({ productId: p.id, product: label, kind: "requiredMissing", detail: `POS'ta zorunlu "${pg.name}" (en az ${pg.min}, en fazla ${pg.max}) WhatsApp'ta sorulmuyor`, posGroup: { name: pg.name, min: pg.min, max: pg.max, choices: pg.items.length } });
          if (pg.items.length > MAX_CHOICES) issues.push({ productId: p.id, product: label, kind: "tooManyChoices", detail: `"${pg.name}" ${pg.items.length} seçenekli; WhatsApp listesi en fazla ${MAX_CHOICES} seçenek gösterebiliyor` });
        }
      }
      for (const g of groups) {
        const pg = found.product.options.find((o) => groupMatches(g, o));
        if (!pg) {
          issues.push({ productId: p.id, product: label, kind: "groupNotInPos", detail: `WhatsApp'ta sorulan "${g.name}" POS'ta bu üründe yok (cevap POS'a ürün notu olarak yazılır)` });
          continue;
        }
        for (const c of g.choices.filter((c) => c.enabled)) {
          if (!pg.items.some((i) => choiceMatches(c, i))) issues.push({ productId: p.id, product: label, kind: "choiceNotInPos", detail: `"${g.name}" içindeki "${c.name}" POS'ta yok (ürün notu olarak yazılır)` });
        }
      }
    }
    if (issues.length) report.issues.push(...issues);
    else report.ok++;
  }
  return report;
}

export interface PosOrderLine {
  itemId: number;
  name: string;
  quantity: number;
  /** Panelde birim fiyat (seçenek ekstraları dahil), kuruş */
  unitKurus: number;
  /** POS'ta seçilecekler; ürün eşleşmediyse null (personel elle ekler) */
  pos: { productName: string; category: string; variant: string | null; options: { group: string; choices: string[] }[]; /** Ürünün POS'taki tüm grup adları (pencerede grup sınırlarını bulmak için) */ groups: string[] } | null;
  /** POS'ta karşılığı olmayan seçimler: ürün notuna yazılır */
  note: string;
}

export interface PosOrderPayload {
  id: number;
  createdAt: string;
  customer: { name: string | null; phone: string | null };
  address: string;
  lat: number | null;
  lng: number | null;
  note: string;
  payment: { label: string; button: "Nakit" | "Kredi Kartı" | "Yemek Çeki" | "Diğer"; sub: string | null };
  totalKurus: number;
  discountKurus: number;
  discountNote: string;
  payableText: string;
  lines: PosOrderLine[];
}

/** Panel ödeme şeklini POS'taki düğmeye çevirir (Yemek Çeki altındaki kart adıyla). */
export function posPayment(label: string): PosOrderPayload["payment"] {
  const l = label.toLocaleLowerCase("tr");
  if (/nakit/.test(l)) return { label, button: "Nakit", sub: null };
  const meal = [
    ["multinet", "Multinet"],
    ["edenred", "Edenred"],
    ["ticket", "Edenred"],
    ["sodexo", "Pluxee (Sodexo)"],
    ["pluxee", "Pluxee (Sodexo)"],
    ["setcard", "SetCard"],
    ["metropol", "Metropol"],
  ].find(([k]) => l.includes(k));
  if (meal) return { label, button: "Yemek Çeki", sub: meal[1] };
  if (/kart|kredi/.test(l)) return { label, button: "Kredi Kartı", sub: null };
  return { label, button: "Diğer", sub: null };
}

type OrderWithItems = {
  id: number;
  createdAt: Date;
  note: string;
  address: string;
  lat: number | null;
  lng: number | null;
  paymentLabel: string;
  totalKurus: number;
  discountKurus: number;
  discountNote: string;
  discountPercent: number;
  customer: { name: string | null; waId: string | null };
  items: { id: number; name: string; quantity: number; unitKurus: number; extraKurus: number; productId: number | null; options: { groupId: number | null; groupName: string; choiceName: string }[] }[];
};

/** Siparişi eklentinin POS'a yazacağı biçime çevirir (POS adlarıyla). */
export async function orderPayload(db: PrismaClient, order: OrderWithItems, snap: PosSnapshotData | null): Promise<PosOrderPayload> {
  const productIds = order.items.map((i) => i.productId).filter((x): x is number => x !== null);
  const products = productIds.length ? await db.product.findMany({ where: { id: { in: productIds } }, include: { optionGroups: { include: { group: { include: { choices: true } } } } } }) : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines: PosOrderLine[] = order.items.map((item) => {
    const p = item.productId !== null ? byId.get(item.productId) : undefined;
    const answers = item.options.filter((o) => o.choiceName);
    const extras: string[] = [];
    let pos: PosOrderLine["pos"] = null;
    const found = p && snap ? findPosProduct(snap.products, p) : null;
    if (found && !("error" in found)) {
      const options: { group: string; choices: string[] }[] = [];
      for (const a of answers) {
        const panelGroup = p!.optionGroups.map((l) => l.group).find((g) => (a.groupId !== null ? g.id === a.groupId : g.name === a.groupName));
        const pg = found.product.options.find((o) => (panelGroup ? groupMatches(panelGroup, o) : posNorm(o.name) === posNorm(a.groupName)));
        // Çoklu seçim tek kayıtta " + " ile birleşik saklanır
        const picked = a.choiceName.split(" + ").map((x) => x.trim()).filter(Boolean);
        for (const choice of picked) {
          const panelChoice = panelGroup?.choices.find((c) => c.name === choice);
          const item2 = pg?.items.find((i) => choiceMatches(panelChoice ?? { name: choice, posName: null }, i));
          if (pg && item2) {
            const slot = options.find((o) => o.group === pg.name) ?? (options.push({ group: pg.name, choices: [] }), options[options.length - 1]);
            slot.choices.push(item2.name);
          } else extras.push(`${a.groupName}: ${choice}`);
        }
      }
      pos = { productName: found.product.name, category: found.product.category, variant: found.variant, options, groups: found.product.options.map((o) => o.name) };
    } else {
      for (const a of answers) extras.push(`${a.groupName}: ${a.choiceName}`);
    }
    return { itemId: item.id, name: item.name, quantity: item.quantity, unitKurus: item.unitKurus + item.extraKurus, pos, note: extras.join(", ") };
  });
  return {
    id: order.id,
    createdAt: order.createdAt.toISOString(),
    customer: { name: order.customer.name, phone: order.customer.waId },
    address: order.address,
    lat: order.lat,
    lng: order.lng,
    note: order.note,
    payment: posPayment(order.paymentLabel),
    totalKurus: order.totalKurus,
    discountKurus: order.discountKurus,
    discountNote: order.discountNote || (order.discountPercent > 0 ? `%${order.discountPercent} ${order.paymentLabel}` : ""),
    payableText: formatTRY(order.totalKurus - order.discountKurus),
    lines,
  };
}
