import type { Brand, Customer, Message, Order, PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";
import { orderVars, renderTemplate, templateFor, type MessageKey } from "./order-messages";
import { recordOutbound } from "./outbound";
import { priceWithDiscount } from "./payment";
import type { WhatsappCloudClient } from "./whatsapp-cloud";

/** Müşteri bu süreden sonra yazarsa eski yarım sipariş artık beklemede sayılmaz (personel elle tamamlar). */
export const OPEN_ORDER_WINDOW_MS = 3 * 60 * 60 * 1000;
const ADDRESS_MIN_LENGTH = 8;

type FullOrder = Order & { brand: Brand; customer: Customer };

/** Düğme/liste yanıtlarının kimlikleri: kimlik hangi siparişe ait olduğunu da taşır, böylece eski mesajdaki düğme yanlış siparişe işlemez. */
export const payId = (orderId: number, paymentTypeId: number) => `pay:${orderId}:${paymentTypeId}`;
export const addrId = (orderId: number, choice: number | "new") => `addr:${orderId}:${choice}`;

/** Aynı adresin farklı yazımlarını tek kayıtta toplamak için anahtar. */
export const addressKey = (text: string) => text.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr");

/** Müşterinin adres listesine ekler (varsa kullanım zamanını yeniler). */
export async function rememberAddress(db: PrismaClient, customerId: number, text: string, lat?: number | null, lng?: number | null): Promise<void> {
  const key = addressKey(text);
  if (!key) return;
  await db.customerAddress.upsert({
    where: { customerId_key: { customerId, key } },
    create: { customerId, text: text.trim(), key, lat: lat ?? null, lng: lng ?? null },
    update: { lastUsedAt: new Date(), ...(lat != null && lng != null ? { lat, lng } : {}) },
  });
}

async function load(db: PrismaClient, orderId: number): Promise<FullOrder | null> {
  return db.order.findUnique({ where: { id: orderId }, include: { brand: true, customer: true } });
}

function canSend(cloud: WhatsappCloudClient | null, o: FullOrder): cloud is WhatsappCloudClient {
  return !!cloud && !!o.brand.waPhoneNumberId && !!o.customer.waId;
}

async function render(db: PrismaClient, o: FullOrder, key: MessageKey): Promise<string> {
  return renderTemplate(await templateFor(db, o.brand.code, key), orderVars(o, o.customer));
}

async function log(db: PrismaClient, o: FullOrder, type: "text" | "catalog", body: string, id: string | null) {
  await recordOutbound(db, { brandId: o.brandId, customerId: o.customerId, type, body, waMessageId: id, orderId: o.id });
}

/** Sipariş yeni geldi: ödeme şekillerini sor (kayıtlı ödeme şekli yoksa doğrudan adrese geç). */
export async function startOrderConversation(db: PrismaClient, cloud: WhatsappCloudClient | null, orderId: number): Promise<void> {
  try {
    const order = await load(db, orderId);
    if (!order || order.stage === "READY") return;
    const types = await db.paymentType.findMany({ where: { brandId: order.brandId, enabled: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], take: 10 });
    if (!types.length) {
      await db.order.update({ where: { id: order.id }, data: { stage: "AWAITING_ADDRESS" } });
      return askAddress(db, cloud, (await load(db, orderId))!);
    }
    await db.order.update({ where: { id: order.id }, data: { stage: "AWAITING_PAYMENT" } });
    if (!canSend(cloud, order)) return;
    const body = await render(db, order, "NEW");
    const id = await cloud.sendList(order.brand.waPhoneNumberId!, order.customer.waId!, {
      body,
      buttonText: "Ödeme şekli seç",
      rows: types.map((t) => ({ id: payId(order.id, t.id), title: t.name, description: t.discountPercent > 0 ? `%${t.discountPercent} indirimli` : undefined })),
    });
    await log(db, order, "text", body, id);
  } catch (err) {
    logger.warn({ err: (err as Error).message, orderId }, "Ödeme sorusu gönderilemedi");
  }
}

async function askAddress(db: PrismaClient, cloud: WhatsappCloudClient | null, order: FullOrder): Promise<void> {
  if (!canSend(cloud, order)) return;
  const saved = await db.customerAddress.findMany({ where: { customerId: order.customerId }, orderBy: [{ lastUsedAt: "desc" }, { id: "desc" }], take: 9 });
  if (saved.length === 1) {
    const body = renderTemplate(await templateFor(db, order.brand.code, "CONFIRM_ADDRESS"), { ...orderVars(order, order.customer), adres: saved[0].text });
    const id = await cloud.sendButtons(order.brand.waPhoneNumberId!, order.customer.waId!, body, [
      { id: addrId(order.id, saved[0].id), title: "Evet, bu adres" },
      { id: addrId(order.id, "new"), title: "Yeni adres" },
    ]);
    await log(db, order, "text", body, id);
    return;
  }
  if (saved.length > 1) {
    const body = await render(db, order, "CHOOSE_ADDRESS");
    const rows = [
      ...saved.map((a, i) => ({ id: addrId(order.id, a.id), title: `Adres ${i + 1}`, description: a.text })),
      { id: addrId(order.id, "new"), title: "Yeni adres" },
    ];
    const id = await cloud.sendList(order.brand.waPhoneNumberId!, order.customer.waId!, { body, buttonText: "Adres seç", rows });
    await log(db, order, "text", body, id);
    return;
  }
  const body = await render(db, order, "ASK_ADDRESS");
  const id = await cloud.sendText(order.brand.waPhoneNumberId!, order.customer.waId!, body);
  await log(db, order, "text", body, id);
}

/** Ödeme ve adres tamam: sipariş hazır olur (panelde sesli uyarı), müşteriye onay gider, adres müşteriye kaydedilir. */
async function finish(db: PrismaClient, cloud: WhatsappCloudClient | null, orderId: number, address: { text: string; lat?: number | null; lng?: number | null }): Promise<void> {
  await db.order.update({ where: { id: orderId }, data: { stage: "READY", address: address.text, lat: address.lat ?? null, lng: address.lng ?? null } });
  const order = (await load(db, orderId))!;
  await rememberAddress(db, order.customerId, address.text, address.lat, address.lng);
  if (!canSend(cloud, order)) return;
  const body = await render(db, order, "CONFIRMED");
  const id = await cloud.sendText(order.brand.waPhoneNumberId!, order.customer.waId!, body);
  await log(db, order, "text", body, id);
}

const OPEN = { status: "NEW", stage: { in: ["AWAITING_PAYMENT", "AWAITING_ADDRESS"] } };

/** Düğme/liste yanıtı: kimliğindeki siparişe işlenir (müşterinin başka yarım siparişi olsa da karışmaz). */
async function orderById(db: PrismaClient, brandId: number, customerId: number, orderId: number, now: Date): Promise<FullOrder | null> {
  if (!Number.isInteger(orderId)) return null;
  return db.order.findFirst({ where: { id: orderId, brandId, customerId, ...OPEN, createdAt: { gte: new Date(now.getTime() - OPEN_ORDER_WINDOW_MS) } }, include: { brand: true, customer: true } });
}

/** Yazı ve konum: önce adres bekleyen en yeni sipariş, yoksa ödeme bekleyen en yeni sipariş. */
async function orderForFreeText(db: PrismaClient, brandId: number, customerId: number, now: Date): Promise<FullOrder | null> {
  const where = { brandId, customerId, status: "NEW", createdAt: { gte: new Date(now.getTime() - OPEN_ORDER_WINDOW_MS) } };
  return (
    (await db.order.findFirst({ where: { ...where, stage: "AWAITING_ADDRESS" }, orderBy: { createdAt: "desc" }, include: { brand: true, customer: true } })) ??
    (await db.order.findFirst({ where: { ...where, stage: "AWAITING_PAYMENT" }, orderBy: { createdAt: "desc" }, include: { brand: true, customer: true } }))
  );
}

interface RawMessage {
  type?: string;
  text?: { body?: string };
  interactive?: { button_reply?: { id?: string }; list_reply?: { id?: string } };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
}

/**
 * Müşteriden gelen bir mesajı bekleyen siparişin akışına işler: ödeme seçimi, adres onayı, yazılı adres, konum.
 * Beklemede sipariş yoksa hiçbir şey yapmaz. Hata fırlatmaz.
 */
export async function handleOrderReply(db: PrismaClient, cloud: WhatsappCloudClient | null, brand: Brand, customer: Customer, message: Message, raw: unknown, now = new Date()): Promise<void> {
  try {
    const m = (raw ?? {}) as RawMessage;
    const reply = m.interactive?.list_reply?.id ?? m.interactive?.button_reply?.id ?? null;
    if (reply) {
      const [kind, orderIdText, arg] = reply.split(":");
      const order = await orderById(db, brand.id, customer.id, Number(orderIdText), now);
      if (!order) return; // bitmiş ya da başkasına ait eski bir mesajdaki düğme
      if (kind === "pay" && order.stage === "AWAITING_PAYMENT") return choosePayment(db, cloud, order, Number(arg));
      if (kind === "addr" && order.stage === "AWAITING_ADDRESS") {
        const chosen = arg === "new" ? null : await db.customerAddress.findFirst({ where: { id: Number(arg), customerId: customer.id } });
        if (chosen) return finish(db, cloud, order.id, { text: chosen.text, lat: chosen.lat, lng: chosen.lng });
        if (arg === "new" && canSend(cloud, order)) {
          const body = await render(db, order, "ASK_ADDRESS");
          const id = await cloud.sendText(order.brand.waPhoneNumberId!, order.customer.waId!, body);
          await log(db, order, "text", body, id);
        }
      }
      return;
    }

    const order = await orderForFreeText(db, brand.id, customer.id, now);
    if (!order) return;

    if (order.stage === "AWAITING_PAYMENT") {
      // Liste yerine yazı yazdı: listeyi yeniden gönder
      if (message.type === "text") await startOrderConversation(db, cloud, order.id);
      return;
    }

    if (order.stage === "AWAITING_ADDRESS") {
      if (m.type === "location" && typeof m.location?.latitude === "number" && typeof m.location.longitude === "number") {
        const label = [m.location.name, m.location.address].filter(Boolean).join(", ");
        return finish(db, cloud, order.id, { text: label || `Konum: ${m.location.latitude.toFixed(5)}, ${m.location.longitude.toFixed(5)}`, lat: m.location.latitude, lng: m.location.longitude });
      }
      if (m.type === "text") {
        const text = (m.text?.body ?? "").trim();
        if (text.length >= ADDRESS_MIN_LENGTH) return finish(db, cloud, order.id, { text });
        if (canSend(cloud, order)) {
          const body = "Adres çok kısa görünüyor. Lütfen mahalle, sokak ve kapı numarasıyla birlikte yazın ya da konumunuzu gönderin.";
          const id = await cloud.sendText(order.brand.waPhoneNumberId!, order.customer.waId!, body);
          await log(db, order, "text", body, id);
        }
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Sipariş akışı yanıtı işlenemedi");
  }
}

async function choosePayment(db: PrismaClient, cloud: WhatsappCloudClient | null, order: FullOrder, paymentTypeId: number): Promise<void> {
  const type = await db.paymentType.findFirst({ where: { id: paymentTypeId, brandId: order.brandId, enabled: true } });
  if (!type) return;
  const { discountKurus } = priceWithDiscount(order.totalKurus, type.discountPercent);
  await db.order.update({ where: { id: order.id }, data: { stage: "AWAITING_ADDRESS", paymentTypeId: type.id, paymentLabel: type.name, discountPercent: type.discountPercent, discountKurus } });
  await askAddress(db, cloud, (await load(db, order.id))!);
}
