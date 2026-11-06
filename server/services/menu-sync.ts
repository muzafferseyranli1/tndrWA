import type { Prisma, PrismaClient } from "@prisma/client";
import { slugify } from "../../shared/slug";

/**
 * Kasa sisteminden (Suitable RMS) hazırlanan menünün panele toplu uygulanması.
 * Menüdeki ürünler eşleştirilip güncellenir ya da oluşturulur; menüde olmayanlar kaldırılır
 * (katalogda olan pasife alınır ki Meta'dan silinsin, olmayan doğrudan silinir). Eski siparişler etkilenmez (ad/fiyat siparişte saklı).
 * dryRun: tüm değişiklikler bir işlem içinde yapılıp geri alınır, yalnızca rapor döner.
 */

export interface MenuSpecChoice {
  name: string;
  priceKurus: number;
}
export interface MenuSpecGroup {
  key: string;
  name: string;
  required: boolean;
  maxSelect: number;
  choices: MenuSpecChoice[];
}
export interface MenuSpecVariant {
  /** null: porsiyonsuz ürün */
  label: string | null;
  priceKurus: number;
  /** Paneldeki eski porsiyon adları (ilk eşitlemede eşleştirmek için) */
  legacyLabels?: (string | null)[];
  /** Bu porsiyona karşılık gelen eski ürün adları (porsiyonları ayrı ürün olarak girilmiş eski kayıtlar için) */
  legacyNames?: string[];
}
export interface MenuSpecProduct {
  /** Kasadaki ad: kalıcı eşleştirme anahtarı ("rms:" ön ekiyle saklanır) */
  source: string;
  /** Müşteriye görünen ad */
  name: string;
  /** Paneldeki eski adlar (ilk eşitlemede eşleştirmek için) */
  legacyNames?: string[];
  variants: MenuSpecVariant[];
  /** MenuSpecGroup.key listesi */
  optionGroups: string[];
}
export interface MenuSpecCategory {
  name: string;
  products: MenuSpecProduct[];
}
export interface MenuSpec {
  optionGroups: MenuSpecGroup[];
  categories: MenuSpecCategory[];
}

export interface MenuSyncReport {
  dryRun: boolean;
  created: string[];
  updated: { name: string; changes: string[] }[];
  unchanged: number;
  removed: string[];
  passivated: string[];
  categories: { created: string[]; removed: string[] };
  optionGroups: { created: string[]; updated: string[]; removed: string[] };
}

class DryRunRollback extends Error {
  constructor(public report: MenuSyncReport) {
    super("dry-run");
  }
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLocaleLowerCase("tr");
const tl = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function validateSpec(spec: MenuSpec): string | null {
  const keys = new Set(spec.optionGroups.map((g) => g.key));
  if (keys.size !== spec.optionGroups.length) return "Seçenek grubu anahtarları benzersiz olmalı.";
  const sources = new Set<string>();
  for (const c of spec.categories) {
    if (!c.name.trim()) return "Kategori adı boş olamaz.";
    for (const p of c.products) {
      if (sources.has(p.source)) return `Aynı kasa ürünü iki kez: ${p.source}`;
      sources.add(p.source);
      if (!p.variants.length) return `${p.name}: en az bir fiyat gerekli.`;
      if (p.variants.length > 1 && p.variants.some((v) => !v.label)) return `${p.name}: porsiyonlu üründe her porsiyonun adı olmalı.`;
      if (p.variants.some((v) => !Number.isInteger(v.priceKurus) || v.priceKurus <= 0)) return `${p.name}: fiyat geçersiz.`;
      for (const k of p.optionGroups) if (!keys.has(k)) return `${p.name}: bilinmeyen seçenek grubu ${k}.`;
    }
  }
  for (const g of spec.optionGroups) {
    if (g.maxSelect < 1 || g.maxSelect > 9) return `${g.name}: en fazla seçim 1-9 arası olmalı.`;
    if (!g.choices.length || g.choices.length > 9) return `${g.name}: 1-9 seçenek olmalı.`;
    if (g.choices.some((c) => c.name.length > 24)) return `${g.name}: seçenek adı en fazla 24 karakter.`;
  }
  return null;
}

async function apply(tx: Prisma.TransactionClient, brandId: number, spec: MenuSpec, report: MenuSyncReport): Promise<void> {
  // 1) Seçenek grupları (ad ile eşleşir)
  const groupIds = new Map<string, number>();
  const existingGroups = await tx.optionGroup.findMany({ where: { brandId }, include: { choices: true } });
  for (const [gi, g] of spec.optionGroups.entries()) {
    let row = existingGroups.find((x) => norm(x.name) === norm(g.name));
    if (!row) {
      row = await tx.optionGroup.create({ data: { brandId, name: g.name, required: g.required, maxSelect: g.maxSelect, enabled: true, sortOrder: gi }, include: { choices: true } });
      report.optionGroups.created.push(g.name);
    } else if (row.required !== g.required || row.maxSelect !== g.maxSelect || !row.enabled || row.sortOrder !== gi) {
      await tx.optionGroup.update({ where: { id: row.id }, data: { required: g.required, maxSelect: g.maxSelect, enabled: true, sortOrder: gi } });
      report.optionGroups.updated.push(g.name);
    }
    groupIds.set(g.key, row.id);
    const keep = new Set<number>();
    for (const [ci, c] of g.choices.entries()) {
      const ch = row.choices.find((x) => norm(x.name) === norm(c.name));
      if (ch) {
        keep.add(ch.id);
        if (ch.extraKurus !== c.priceKurus || !ch.enabled || ch.sortOrder !== ci) {
          await tx.optionChoice.update({ where: { id: ch.id }, data: { extraKurus: c.priceKurus, enabled: true, sortOrder: ci } });
          if (!report.optionGroups.updated.includes(g.name)) report.optionGroups.updated.push(g.name);
        }
      } else {
        const created = await tx.optionChoice.create({ data: { groupId: row.id, name: c.name, extraKurus: c.priceKurus, sortOrder: ci } });
        keep.add(created.id);
        if (!report.optionGroups.created.includes(g.name) && !report.optionGroups.updated.includes(g.name)) report.optionGroups.updated.push(g.name);
      }
    }
    const stale = row.choices.filter((x) => !keep.has(x.id)).map((x) => x.id);
    if (stale.length) await tx.optionChoice.deleteMany({ where: { id: { in: stale } } });
  }
  for (const g of existingGroups) {
    if (!spec.optionGroups.some((s) => norm(s.name) === norm(g.name))) {
      await tx.optionGroup.delete({ where: { id: g.id } });
      report.optionGroups.removed.push(g.name);
    }
  }

  // 2) Kategoriler (ad ile eşleşir, menü sırası)
  const categoryIds = new Map<string, number>();
  const existingCats = await tx.category.findMany({ where: { brandId } });
  for (const [ci, c] of spec.categories.entries()) {
    let cat = existingCats.find((x) => norm(x.name) === norm(c.name));
    if (!cat) {
      cat = await tx.category.create({ data: { brandId, name: c.name, sortOrder: ci } });
      report.categories.created.push(c.name);
    } else if (cat.sortOrder !== ci) {
      await tx.category.update({ where: { id: cat.id }, data: { sortOrder: ci } });
    }
    categoryIds.set(c.name, cat.id);
  }

  // 3) Ürünler: kasa anahtarı → eski ad+porsiyon ile eşleştir, güncelle ya da oluştur
  const products = await tx.product.findMany({ where: { brandId }, include: { category: true } });
  const used = new Set<number>();
  const takenRetailer = new Set(products.map((p) => p.retailerId));
  const uniqueRetailer = (base: string) => {
    const root = base || "urun";
    let candidate = root;
    for (let n = 2; takenRetailer.has(candidate); n++) candidate = `${root}-${n}`;
    takenRetailer.add(candidate);
    return candidate;
  };

  for (const c of spec.categories) {
    const categoryId = categoryIds.get(c.name)!;
    for (const [pi, p] of c.products.entries()) {
      const key = `rms:${p.source}`;
      const names = [p.name, p.source, ...(p.legacyNames ?? [])].map(norm);
      const grouped = p.variants.length > 1;
      let groupKey: string | null = null;
      if (grouped) {
        const prior = products.find((x) => !used.has(x.id) && x.groupKey && (x.sourceKey === key || names.includes(norm(x.name))));
        groupKey = prior?.groupKey ?? `rms-${slugify(p.source)}`;
      }
      const createdIds: number[] = [];
      let siblingImage: string | null = null;
      for (const [vi, v] of p.variants.entries()) {
        const labels = [v.label, ...(v.legacyLabels ?? [])].map(norm);
        const vNames = v.legacyNames ? [...names, ...v.legacyNames.map(norm)] : names;
        const match =
          products.find((x) => !used.has(x.id) && x.sourceKey === key && labels.includes(norm(x.variantLabel))) ??
          (v.legacyNames ? products.find((x) => !used.has(x.id) && !x.sourceKey && v.legacyNames!.map(norm).includes(norm(x.name)) && labels.includes(norm(x.variantLabel))) : undefined) ??
          products.find((x) => !used.has(x.id) && !x.sourceKey && vNames.includes(norm(x.name)) && labels.includes(norm(x.variantLabel)));
        const sortOrder = pi * 10 + vi;
        const display = v.label ? `${p.name} (${v.label})` : p.name;
        if (!match) {
          const created = await tx.product.create({
            data: { brandId, retailerId: uniqueRetailer(slugify(v.label ? `${p.name} ${v.label}` : p.name)), name: p.name, variantLabel: v.label, groupKey, priceKurus: v.priceKurus, categoryId, status: "ACTIVE", sortOrder, sourceKey: key, metaSyncState: "PENDING" },
          });
          used.add(created.id);
          createdIds.push(created.id);
          report.created.push(`${display} · ${tl(v.priceKurus)} TL`);
          await tx.productOptionGroup.createMany({ data: p.optionGroups.map((k) => ({ productId: created.id, groupId: groupIds.get(k)! })) });
          continue;
        }
        used.add(match.id);
        siblingImage ??= match.imagePath;
        const changes: string[] = [];
        if (match.name !== p.name) changes.push(`ad: ${match.name} → ${p.name}`);
        if ((match.variantLabel ?? null) !== v.label) changes.push(`porsiyon: ${match.variantLabel ?? "-"} → ${v.label ?? "-"}`);
        if (match.priceKurus !== v.priceKurus) changes.push(`fiyat: ${tl(match.priceKurus)} → ${tl(v.priceKurus)}`);
        if (match.categoryId !== categoryId) changes.push(`kategori: ${match.category.name} → ${c.name}`);
        if (match.status !== "ACTIVE") changes.push("aktifleştirildi");
        const catalogChange = changes.length > 0 || (match.groupKey ?? null) !== groupKey;
        await tx.product.update({
          where: { id: match.id },
          data: { name: p.name, variantLabel: v.label, groupKey, priceKurus: v.priceKurus, categoryId, status: "ACTIVE", sortOrder, sourceKey: key, ...(catalogChange ? { metaSyncState: "PENDING" } : {}) },
        });
        const links = await tx.productOptionGroup.findMany({ where: { productId: match.id } });
        const want = new Set(p.optionGroups.map((k) => groupIds.get(k)!));
        const have = new Set(links.map((l) => l.groupId));
        if (want.size !== have.size || [...want].some((g) => !have.has(g))) {
          await tx.productOptionGroup.deleteMany({ where: { productId: match.id } });
          await tx.productOptionGroup.createMany({ data: [...want].map((groupId) => ({ productId: match.id, groupId })) });
          changes.push("seçenekler güncellendi");
        }
        if (changes.length) report.updated.push({ name: display, changes });
        else report.unchanged++;
      }
      // Mevcut yemeğe eklenen yeni porsiyon, kardeşinin görselini alır (görselsiz ürün Meta kataloğuna gönderilemez)
      if (siblingImage && createdIds.length) await tx.product.updateMany({ where: { id: { in: createdIds } }, data: { imagePath: siblingImage } });
    }
  }

  // 4) Menüde olmayan ürünler: katalogdaysa pasife (Meta'dan silinsin), değilse sil
  for (const x of products) {
    if (used.has(x.id)) continue;
    const display = x.variantLabel ? `${x.name} (${x.variantLabel})` : x.name;
    if (x.onMeta) {
      if (x.status !== "PASSIVE") {
        await tx.product.update({ where: { id: x.id }, data: { status: "PASSIVE", metaSyncState: "PENDING" } });
        report.passivated.push(display);
      }
    } else {
      await tx.product.delete({ where: { id: x.id } });
      report.removed.push(display);
    }
  }

  // 5) Menüde olmayan ve boşalan kategoriler silinir
  for (const cat of existingCats) {
    if (spec.categories.some((c) => norm(c.name) === norm(cat.name))) continue;
    if ((await tx.product.count({ where: { categoryId: cat.id } })) === 0) {
      await tx.category.delete({ where: { id: cat.id } });
      report.categories.removed.push(cat.name);
    }
  }
}

export async function syncMenu(db: PrismaClient, brandId: number, spec: MenuSpec, dryRun: boolean): Promise<MenuSyncReport> {
  const report: MenuSyncReport = { dryRun, created: [], updated: [], unchanged: 0, removed: [], passivated: [], categories: { created: [], removed: [] }, optionGroups: { created: [], updated: [], removed: [] } };
  try {
    await db.$transaction(
      async (tx) => {
        await apply(tx, brandId, spec, report);
        if (dryRun) throw new DryRunRollback(report);
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (err) {
    if (err instanceof DryRunRollback) return err.report;
    throw err;
  }
  return report;
}
