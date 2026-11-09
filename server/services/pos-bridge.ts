import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { normalizePhone } from "../../shared/channels";
import { addressKey } from "./addresses";
import { MAX_CHOICES } from "./options";
import { findPosProduct, latestSnapshot, posNorm, type PosSnapshotData } from "./pos-map";

const TOKEN_KEY = "pos.tokenHash";
const sha = (s: string) => createHash("sha256").update(s).digest();

/** Eklenti anahtarı üretir; veritabanında yalnız özeti tutulur, anahtar bir kez gösterilir. Eski anahtar geçersiz olur. */
export async function newPosToken(db: PrismaClient): Promise<string> {
  const token = `tpos_${randomBytes(24).toString("base64url")}`;
  const hash = sha(token).toString("hex");
  await db.setting.upsert({ where: { key: TOKEN_KEY }, create: { key: TOKEN_KEY, value: hash }, update: { value: hash } });
  return token;
}

export async function posTokenSet(db: PrismaClient): Promise<boolean> {
  return !!(await db.setting.findUnique({ where: { key: TOKEN_KEY } }))?.value;
}

export async function verifyPosToken(db: PrismaClient, token: string | undefined): Promise<boolean> {
  if (!token || token.length > 200) return false;
  const stored = (await db.setting.findUnique({ where: { key: TOKEN_KEY } }))?.value;
  if (!stored || stored.length !== 64) return false;
  return timingSafeEqual(sha(token), Buffer.from(stored, "hex"));
}

/** Eklentinin okuduğu POS menüsünü saklar (marka başına son 10 görüntü tutulur). */
export async function storeSnapshot(db: PrismaClient, brandId: number, data: PosSnapshotData): Promise<void> {
  await db.posSnapshot.create({ data: { brandId, cafeId: data.cafeId, cafeName: data.cafeName, data: JSON.stringify(data), productCount: data.products.length } });
  const old = await db.posSnapshot.findMany({ where: { brandId }, orderBy: { id: "desc" }, skip: 10, select: { id: true } });
  if (old.length) await db.posSnapshot.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

export interface PosCustomerIn {
  name: string | null;
  phones: string[];
  addresses: string[];
}

export interface PosCustomerStats {
  read: number;
  noPhone: number;
  created: number;
  existing: number;
  namesFilled: number;
  addressesAdded: number;
}

/** Cep numarası (905…) öncelikli, yoksa ilk geçerli numara. */
export function primaryPhone(phones: string[]): string | null {
  const valid = phones.map((p) => normalizePhone(p)).filter((p): p is string => !!p);
  return valid.find((p) => p.startsWith("905")) ?? valid[0] ?? null;
}

/**
 * POS müşterilerini panele alır: telefona göre eşler, olmayanı ekler, boş adı doldurur, yeni adresleri ekler.
 * Paneldeki dolu alanların üzerine yazmaz, hiçbir şey silmez.
 */
export async function importPosCustomers(db: PrismaClient, customers: PosCustomerIn[]): Promise<PosCustomerStats> {
  const stats: PosCustomerStats = { read: customers.length, noPhone: 0, created: 0, existing: 0, namesFilled: 0, addressesAdded: 0 };
  const byPhone = new Map<string, { name: string | null; addresses: string[] }>();
  for (const c of customers) {
    const phone = primaryPhone(c.phones);
    if (!phone) {
      stats.noPhone++;
      continue;
    }
    const prev = byPhone.get(phone);
    const addresses = c.addresses.map((a) => a.trim().replace(/\s+/g, " ")).filter((a) => a.length >= 5);
    if (prev) prev.addresses.push(...addresses);
    else byPhone.set(phone, { name: c.name?.trim() || null, addresses });
  }
  const phones = [...byPhone.keys()];
  for (let i = 0; i < phones.length; i += 400) {
    const batch = phones.slice(i, i + 400);
    const existing = await db.customer.findMany({ where: { waId: { in: batch } }, include: { addresses: { select: { key: true } } } });
    const known = new Map(existing.map((c) => [c.waId!, c]));
    const fresh = batch.filter((p) => !known.has(p));
    if (fresh.length) {
      await db.customer.createMany({ data: fresh.map((p) => ({ waId: p, name: byPhone.get(p)!.name })) });
      stats.created += fresh.length;
    }
    const createdRows = fresh.length ? await db.customer.findMany({ where: { waId: { in: fresh } }, select: { id: true, waId: true } }) : [];
    const ids = new Map<string, number>([...existing.map((c) => [c.waId!, c.id] as const), ...createdRows.map((c) => [c.waId!, c.id] as const)]);
    const addressRows: { customerId: number; text: string; key: string }[] = [];
    for (const phone of batch) {
      const incoming = byPhone.get(phone)!;
      const k = known.get(phone);
      if (k) {
        stats.existing++;
        if (!k.name && incoming.name) {
          await db.customer.update({ where: { id: k.id }, data: { name: incoming.name } });
          stats.namesFilled++;
        }
      }
      const customerId = ids.get(phone);
      if (!customerId) continue;
      const keys = new Set(k?.addresses.map((a) => a.key) ?? []);
      for (const text of incoming.addresses) {
        const key = addressKey(text);
        if (keys.has(key)) continue;
        keys.add(key);
        addressRows.push({ customerId, text, key });
      }
    }
    if (addressRows.length) {
      await db.customerAddress.createMany({ data: addressRows });
      stats.addressesAdded += addressRows.length;
    }
  }
  return stats;
}

export class PosApplyError extends Error {}

/**
 * POS'ta zorunlu olup WhatsApp'ta sorulmayan seçenek grubunu panele ekler ve ürüne (porsiyonlarıyla) bağlar.
 * Aynı adlı (ya da aynı POS adlı) grup varsa onu kullanır, eksik seçimlerini tamamlar.
 */
export async function applyPosGroup(db: PrismaClient, brandId: number, productId: number, posGroupName: string): Promise<{ groupId: number; created: boolean; linked: number }> {
  const snap = await latestSnapshot(db, brandId);
  if (!snap) throw new PosApplyError("Önce eklentiden POS menüsünü gönderin.");
  const product = await db.product.findFirst({ where: { id: productId, brandId } });
  if (!product) throw new PosApplyError("Ürün bulunamadı.");
  const found = findPosProduct(snap.data.products, product);
  if ("error" in found) throw new PosApplyError("Ürünün POS karşılığı bulunamadı.");
  const pg = found.product.options.find((o) => posNorm(o.name) === posNorm(posGroupName));
  if (!pg) throw new PosApplyError("Bu seçenek grubu POS'ta bu üründe yok.");
  if (pg.items.length > MAX_CHOICES) throw new PosApplyError(`"${pg.name}" ${pg.items.length} seçenekli; WhatsApp listesi en fazla ${MAX_CHOICES} seçenek gösterebiliyor. Bu grup için sayfalı liste gerekiyor.`);

  const groups = await db.optionGroup.findMany({ where: { brandId }, include: { choices: true } });
  let group = groups.find((g) => posNorm(g.posName ?? "") === posNorm(pg.name)) ?? groups.find((g) => posNorm(g.name) === posNorm(pg.name));
  let created = false;
  if (!group) {
    const last = await db.optionGroup.findFirst({ where: { brandId }, orderBy: { sortOrder: "desc" } });
    const row = await db.optionGroup.create({
      data: { brandId, name: pg.name.slice(0, 40), posName: pg.name, required: pg.min >= 1, maxSelect: Math.max(1, Math.min(pg.max || 1, MAX_CHOICES)), sortOrder: (last?.sortOrder ?? -1) + 1 },
    });
    group = { ...row, choices: [] };
    created = true;
  } else if (!group.posName) {
    await db.optionGroup.update({ where: { id: group.id }, data: { posName: pg.name } });
  }
  // Seçimler: WhatsApp listesinde başlık en fazla 24 karakter; POS adı ayrıca saklanır
  const used = new Set(group.choices.map((c) => c.name));
  let order = group.choices.reduce((m, c) => Math.max(m, c.sortOrder), -1) + 1;
  for (const item of pg.items) {
    if (group.choices.some((c) => posNorm(c.posName ?? c.name) === posNorm(item.name) || posNorm(c.name) === posNorm(item.name))) continue;
    let name = item.name.slice(0, 24).trim();
    for (let n = 2; used.has(name); n++) name = `${item.name.slice(0, 21).trim()} ${n}`;
    used.add(name);
    await db.optionChoice.create({ data: { groupId: group.id, name, posName: item.name, extraKurus: Math.round(item.price * 100), sortOrder: order++ } });
  }
  // Ürüne ve aynı yemeğin diğer porsiyonlarına bağla
  const siblings = product.groupKey ? await db.product.findMany({ where: { brandId, groupKey: product.groupKey }, select: { id: true } }) : [{ id: product.id }];
  let linked = 0;
  for (const s of siblings) {
    const exists = await db.productOptionGroup.findUnique({ where: { productId_groupId: { productId: s.id, groupId: group.id } } });
    if (!exists) {
      await db.productOptionGroup.create({ data: { productId: s.id, groupId: group.id } });
      linked++;
    }
  }
  return { groupId: group.id, created, linked };
}

// ---------- POS müşteri sorgusu (otomatik) ----------
// Sipariş başlayınca müşterinin telefonu POS'ta aranır: eklenti bekleyen sorguları sipariş listesiyle birlikte alır,
// POS'a bağlı tüm işletmelerin müşteri kayıtlarında telefonla arar, bulduklarını (ad + adresler) panele aktarır.
// Böylece müşteriye WhatsApp'ta POS'taki kayıtlı adresleri sunulur; elle "Müşterileri panele gönder" gerekmez.
const LOOKUP_KEY = "pos.lookups";
const LOOKUP_PENDING_MS = 10 * 60 * 1000; // eklenti bu sürede almazsa düşer
const LOOKUP_FRESH_MS = 6 * 60 * 60 * 1000; // aynı numara 6 saatte bir sorulur

type LookupState = { pending: Record<string, number>; done: Record<string, number> };

async function readLookups(db: PrismaClient): Promise<LookupState> {
  const raw = (await db.setting.findUnique({ where: { key: LOOKUP_KEY } }))?.value;
  const s = raw ? (JSON.parse(raw) as Partial<LookupState>) : {};
  const now = Date.now();
  const pending = Object.fromEntries(Object.entries(s.pending ?? {}).filter(([, at]) => now - at < LOOKUP_PENDING_MS));
  const done = Object.fromEntries(Object.entries(s.done ?? {}).filter(([, at]) => now - at < LOOKUP_FRESH_MS));
  return { pending, done };
}
async function writeLookups(db: PrismaClient, s: LookupState): Promise<void> {
  const value = JSON.stringify(s);
  await db.setting.upsert({ where: { key: LOOKUP_KEY }, create: { key: LOOKUP_KEY, value }, update: { value } });
}

/** Müşterinin telefonu için POS sorgusu ister (POS'a bağlı işletme yoksa ya da yakın zamanda sorulduysa bir şey yapmaz). */
export async function requestPosLookup(db: PrismaClient, waId: string | null | undefined): Promise<void> {
  const phone = normalizePhone(waId ?? "");
  if (!phone) return;
  if (!(await db.brand.count({ where: { posCafeId: { not: null } } }))) return;
  const s = await readLookups(db);
  if (s.pending[phone] || s.done[phone]) return;
  s.pending[phone] = Date.now();
  await writeLookups(db, s);
}

/** Eklentiye verilecek bekleyen sorgular (telefonlar, 905… biçiminde). */
export async function pendingPosLookups(db: PrismaClient): Promise<string[]> {
  return Object.keys((await readLookups(db)).pending).slice(0, 20);
}

/** Eklentinin sorgu sonucu: bulunan POS kayıtları panele aktarılır, sorgular tamamlandı sayılır. */
export async function resolvePosLookups(db: PrismaClient, phones: string[], customers: PosCustomerIn[]): Promise<PosCustomerStats> {
  const stats = await importPosCustomers(db, customers);
  const s = await readLookups(db);
  for (const p of phones) {
    const phone = normalizePhone(p);
    if (!phone) continue;
    delete s.pending[phone];
    s.done[phone] = Date.now();
  }
  await writeLookups(db, s);
  return stats;
}
