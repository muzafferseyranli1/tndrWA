import type { Brand, Customer, Order, OrderItem, PrismaClient } from "@prisma/client";
import { availabilityOf, type ProductStatus } from "../../shared/availability";
import { formatTRY, percentOf } from "../../shared/money";
import { orderVars, renderTemplate, templateFor } from "./order-messages";
import { recordOutbound } from "./outbound";
import type { WhatsappCloudClient } from "./whatsapp-cloud";

/** Yola çıkmış ya da bitmiş siparişte düzenleme anlamsızdır. */
export const EDITABLE_STATUSES = ["NEW", "PREPARING"];
export const MAX_QUANTITY = 99;

/** Hata mesajı doğrudan personele gösterilir. */
export class EditError extends Error {
  constructor(
    message: string,
    public readonly status = 409,
  ) {
    super(message);
  }
}

type Db = PrismaClient;

async function editable(db: Db, orderId: number): Promise<Order> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new EditError("Sipariş bulunamadı.", 404);
  if (!EDITABLE_STATUSES.includes(order.status)) throw new EditError("Yola çıkmış, teslim edilmiş ya da iptal edilmiş sipariş düzenlenemez.");
  return order;
}

/** Ürünlerden toplamı, indirim oranından indirimi yeniden hesaplar. */
async function recalc(db: Db, orderId: number): Promise<void> {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  const total = order.items.reduce((sum, i) => sum + i.unitKurus * i.quantity, 0);
  const discount = order.discountPercent > 0 ? percentOf(total, order.discountPercent) : 0;
  await db.order.update({ where: { id: orderId }, data: { totalKurus: total, discountKurus: discount } });
}

const note = (db: Db, orderId: number, text: string) => db.orderChange.create({ data: { orderId, text: text.slice(0, 300) } });
const needsNotice = (db: Db, orderId: number) => db.order.update({ where: { id: orderId }, data: { noticePending: true } });

const checkQuantity = (q: number) => {
  if (!Number.isInteger(q) || q < 1 || q > MAX_QUANTITY) throw new EditError(`Adet 1 ile ${MAX_QUANTITY} arasında olmalı.`, 400);
};

export async function addItem(db: Db, orderId: number, productId: number, quantity: number): Promise<void> {
  const order = await editable(db, orderId);
  checkQuantity(quantity);
  const product = await db.product.findFirst({ where: { id: productId, brandId: order.brandId } });
  if (!product) throw new EditError("Ürün bu markada bulunamadı.", 404);
  const availability = availabilityOf({ status: product.status as ProductStatus, soldOutUntil: product.soldOutUntil }, new Date());
  if (availability === "HIDDEN") throw new EditError("Bu ürün pasif, siparişe eklenemez.");
  if (availability === "OUT_OF_STOCK") throw new EditError("Bu ürün bugün tükendi, siparişe eklenemez.");

  const name = product.variantLabel ? `${product.name} (${product.variantLabel})` : product.name;
  const existing = await db.orderItem.findFirst({ where: { orderId, productId: product.id } });
  if (existing) {
    const next = existing.quantity + quantity;
    if (next > MAX_QUANTITY) throw new EditError(`Bir üründen en fazla ${MAX_QUANTITY} adet olabilir.`, 400);
    await db.orderItem.update({ where: { id: existing.id }, data: { quantity: next } });
    await note(db, orderId, `Adet arttı: ${name} ${existing.quantity} → ${next}`);
  } else {
    await db.orderItem.create({ data: { orderId, productId: product.id, retailerId: product.retailerId, name, unitKurus: product.priceKurus, quantity } });
    await note(db, orderId, `Ürün eklendi: ${quantity}× ${name} (${formatTRY(product.priceKurus)})`);
  }
  await recalc(db, orderId);
  await needsNotice(db, orderId);
}

async function itemOf(db: Db, orderId: number, itemId: number): Promise<OrderItem> {
  const item = await db.orderItem.findFirst({ where: { id: itemId, orderId } });
  if (!item) throw new EditError("Sipariş kalemi bulunamadı.", 404);
  return item;
}

export async function setQuantity(db: Db, orderId: number, itemId: number, quantity: number): Promise<void> {
  await editable(db, orderId);
  checkQuantity(quantity);
  const item = await itemOf(db, orderId, itemId);
  if (item.quantity === quantity) return;
  await db.orderItem.update({ where: { id: itemId }, data: { quantity } });
  await note(db, orderId, `Adet değişti: ${item.name} ${item.quantity} → ${quantity}`);
  await recalc(db, orderId);
  await needsNotice(db, orderId);
}

export async function removeItem(db: Db, orderId: number, itemId: number): Promise<void> {
  await editable(db, orderId);
  const item = await itemOf(db, orderId, itemId);
  if ((await db.orderItem.count({ where: { orderId } })) <= 1) throw new EditError("Siparişte en az bir ürün kalmalı. Hepsini çıkarmak için siparişi iptal edin.");
  await db.orderItem.delete({ where: { id: itemId } });
  await note(db, orderId, `Ürün çıkarıldı: ${item.quantity}× ${item.name}`);
  await recalc(db, orderId);
  await needsNotice(db, orderId);
}

export interface DetailsPatch {
  note?: string;
  address?: string;
  paymentTypeId?: number;
}

/** Not, adres ve ödeme şekli. Ödeme şekli değişince indirim yeniden hesaplanır. */
export async function editDetails(db: Db, orderId: number, patch: DetailsPatch): Promise<void> {
  const order = await editable(db, orderId);
  let noticeNeeded = false;

  if (patch.note !== undefined && patch.note.trim() !== order.note) {
    await db.order.update({ where: { id: orderId }, data: { note: patch.note.trim() } });
    await note(db, orderId, patch.note.trim() ? `Sipariş notu değişti: ${patch.note.trim()}` : "Sipariş notu silindi");
  }
  if (patch.address !== undefined && patch.address.trim() !== order.address) {
    const address = patch.address.trim();
    if (!address) throw new EditError("Adres boş olamaz.", 400);
    // Koordinat eski adrese aitti, yeni yazılı adresle çelişmesin
    await db.order.update({ where: { id: orderId }, data: { address, lat: null, lng: null } });
    await note(db, orderId, `Adres değişti: ${order.address || "(boş)"} → ${address}`);
    noticeNeeded = true;
  }
  if (patch.paymentTypeId !== undefined && patch.paymentTypeId !== order.paymentTypeId) {
    const type = await db.paymentType.findFirst({ where: { id: patch.paymentTypeId, brandId: order.brandId } });
    if (!type) throw new EditError("Ödeme şekli bulunamadı.", 404);
    await db.order.update({ where: { id: orderId }, data: { paymentTypeId: type.id, paymentLabel: type.name, discountPercent: type.discountPercent } });
    await recalc(db, orderId);
    await note(db, orderId, `Ödeme şekli değişti: ${order.paymentLabel || "(yok)"} → ${type.name} (%${type.discountPercent} indirim)`);
    noticeNeeded = true;
  }
  if (noticeNeeded) await needsNotice(db, orderId);
}

export interface UpdateNotice {
  sent: boolean;
  error?: string;
}

/** Güncel özeti müşteriye gönderir ("Siparişiniz güncellendi"). Başarılı olursa bekleyen bildirim işareti kalkar. */
export async function sendUpdateNotice(db: Db, cloud: WhatsappCloudClient | null, orderId: number): Promise<UpdateNotice> {
  const order = (await db.order.findUnique({ where: { id: orderId }, include: { items: { orderBy: { id: "asc" } }, brand: true, customer: true } })) as
    | (Order & { items: OrderItem[]; brand: Brand; customer: Customer })
    | null;
  if (!order) throw new EditError("Sipariş bulunamadı.", 404);
  if (!cloud) return { sent: false, error: "WhatsApp gönderim jetonu tanımlı değil." };
  if (!order.brand.waPhoneNumberId) return { sent: false, error: "Markanın Cloud API numara kimliği girilmemiş." };
  if (!order.customer.waId) return { sent: false, error: "Müşterinin telefon numarası yok." };
  try {
    const urunler = order.items.map((i) => `${i.quantity}× ${i.name} — ${formatTRY(i.unitKurus * i.quantity)}`).join("\n");
    const text = renderTemplate(await templateFor(db, order.brand.code, "ORDER_UPDATED"), { ...orderVars(order, order.customer), urunler });
    const id = await cloud.sendText(order.brand.waPhoneNumberId, order.customer.waId, text);
    await recordOutbound(db, { brandId: order.brandId, customerId: order.customerId, type: "text", body: text, waMessageId: id, orderId });
    await db.order.update({ where: { id: orderId }, data: { noticePending: false } });
    await note(db, orderId, "Müşteriye güncel özet gönderildi");
    return { sent: true };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}
