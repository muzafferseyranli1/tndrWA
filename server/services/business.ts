import type { PrismaClient } from "@prisma/client";

export interface BusinessInfo {
  legalName: string;
  address: string;
  email: string;
  phone: string;
  /** VERBIS sicil numarası (kayıt gereken işletmelerde); boş olabilir */
  verbis: string;
}

export interface Retention {
  messagesDays: number;
  ordersDays: number;
  ratingsDays: number;
}

const BUSINESS_KEYS: Record<keyof BusinessInfo, string> = {
  legalName: "business.legalName",
  address: "business.address",
  email: "business.email",
  phone: "business.phone",
  verbis: "business.verbis",
};
const DEFAULT_BUSINESS: BusinessInfo = { legalName: "", address: "", email: "info@yerindepide.com", phone: "0216 362 00 55", verbis: "" };

export const DEFAULT_RETENTION: Retention = { messagesDays: 90, ordersDays: 730, ratingsDays: 730 };
const RETENTION_KEYS: Record<keyof Retention, string> = { messagesDays: "retention.messagesDays", ordersDays: "retention.ordersDays", ratingsDays: "retention.ratingsDays" };
export const RETENTION_LIMITS: Record<keyof Retention, [number, number]> = { messagesDays: [7, 3650], ordersDays: [30, 3650], ratingsDays: [30, 3650] };

async function readAll(db: PrismaClient, keys: string[]): Promise<Map<string, string>> {
  const rows = await db.setting.findMany({ where: { key: { in: keys } } });
  return new Map(rows.map((r) => [r.key, r.value]));
}

async function write(db: PrismaClient, key: string, value: string) {
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function getBusiness(db: PrismaClient): Promise<BusinessInfo> {
  const map = await readAll(db, Object.values(BUSINESS_KEYS));
  const out = { ...DEFAULT_BUSINESS };
  for (const k of Object.keys(BUSINESS_KEYS) as (keyof BusinessInfo)[]) {
    const v = map.get(BUSINESS_KEYS[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export async function setBusiness(db: PrismaClient, patch: Partial<BusinessInfo>): Promise<void> {
  for (const k of Object.keys(BUSINESS_KEYS) as (keyof BusinessInfo)[]) {
    if (patch[k] !== undefined) await write(db, BUSINESS_KEYS[k], patch[k]!.trim());
  }
}

/** Gizlilik sayfalarının yayımlanması için zorunlu bilgiler dolu mu? (VERBIS isteğe bağlı) */
export const businessReady = (b: BusinessInfo) => !!(b.legalName.trim() && b.address.trim() && b.email.trim() && b.phone.trim());

export async function getRetention(db: PrismaClient): Promise<Retention> {
  const map = await readAll(db, Object.values(RETENTION_KEYS));
  const out = { ...DEFAULT_RETENTION };
  for (const k of Object.keys(RETENTION_KEYS) as (keyof Retention)[]) {
    const n = Number(map.get(RETENTION_KEYS[k]));
    const [min, max] = RETENTION_LIMITS[k];
    if (Number.isInteger(n) && n >= min && n <= max) out[k] = n;
  }
  return out;
}

export async function setRetention(db: PrismaClient, patch: Partial<Retention>): Promise<void> {
  for (const k of Object.keys(RETENTION_KEYS) as (keyof Retention)[]) {
    if (patch[k] !== undefined) await write(db, RETENTION_KEYS[k], String(patch[k]));
  }
}

export interface EraseResult {
  customers: number;
  messages: number;
  addresses: number;
  ratings: number;
  events: number;
}

/**
 * Müşterinin kişisel verilerini siler/anonimleştirir: yazışma, adresler, ham webhook olayları silinir;
 * ad ve telefon kaldırılır; siparişler (mali kayıt) kalır ama adres ve konum temizlenir; değerlendirmelerdeki ad/telefon/yorum silinir.
 */
export async function eraseByPhone(db: PrismaClient, phone: string): Promise<EraseResult> {
  const customers = await db.customer.findMany({ where: { waId: phone }, select: { id: true } });
  const ids = customers.map((c) => c.id);
  const result: EraseResult = { customers: ids.length, messages: 0, addresses: 0, ratings: 0, events: 0 };
  if (ids.length) {
    result.messages = (await db.message.deleteMany({ where: { customerId: { in: ids } } })).count;
    result.addresses = (await db.customerAddress.deleteMany({ where: { customerId: { in: ids } } })).count;
    await db.order.updateMany({ where: { customerId: { in: ids } }, data: { address: "", lat: null, lng: null } });
    await db.customer.updateMany({ where: { id: { in: ids } }, data: { waId: null, bsuid: null, name: null, readAt: null, address: null, lat: null, lng: null, noticeSentAt: null } });
  }
  // Siparişe bağlı olmayan (QR'dan) değerlendirmelerde telefonla eşleşenler
  result.ratings = (await db.rating.updateMany({ where: { OR: [{ phone }, ...(ids.length ? [{ customerId: { in: ids } }] : [])] }, data: { phone: null, name: null, comment: "" } })).count;
  result.events = (await db.webhookEvent.deleteMany({ where: { body: { contains: phone } } })).count;
  return result;
}

export interface PurgeResult {
  messages: number;
  orders: number;
  ratings: number;
}

/** Saklama süresi dolan kayıtları siler. */
export async function purgeExpired(db: PrismaClient, now = new Date()): Promise<PurgeResult> {
  const r = await getRetention(db);
  const before = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const messages = (await db.message.deleteMany({ where: { createdAt: { lt: before(r.messagesDays) } } })).count;
  const ratings = (await db.rating.deleteMany({ where: { createdAt: { lt: before(r.ratingsDays) } } })).count;
  // Yalnızca tamamlanmış/iptal siparişler; açık sipariş asla silinmez
  const orders = (await db.order.deleteMany({ where: { createdAt: { lt: before(r.ordersDays) }, status: { in: ["DELIVERED", "CANCELLED"] } } })).count;
  return { messages, orders, ratings };
}
