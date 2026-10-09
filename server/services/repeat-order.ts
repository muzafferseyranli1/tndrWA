import type { Brand, Customer, Message, PrismaClient } from "@prisma/client";
import { availabilityOf, type ProductStatus } from "../../shared/availability";
import { formatTRY } from "../../shared/money";
import { logger } from "../lib/logger";
import { brandOrderingState, getMinBasket, sendClosedNotice, sendMinBasketNotice } from "./hours";
import { OPEN_ORDER_WINDOW_MS, startOrderConversation } from "./order-flow";
import { needsOptions } from "./options";
import { recordOutbound } from "./outbound";
import type { WhatsappCloudClient } from "./whatsapp-cloud";

export const REPEAT_HINT = "Son siparişinizi aynen tekrarlamak için *1* yazın.";

/** Müşterinin tekrarlanabilir son siparişi: iptal edilmemiş, müşteri akışını tamamlamış (hazır) ve ürünü olan en yeni sipariş. */
export async function findRepeatable(db: PrismaClient, brandId: number, customerId: number) {
  return db.order.findFirst({
    where: { brandId, customerId, stage: "READY", status: { not: "CANCELLED" }, items: { some: {} } },
    orderBy: { id: "desc" },
    include: { items: { orderBy: { id: "asc" } } },
  });
}

/**
 * Müşteri tek başına "1" yazdıysa son siparişini güncel fiyatlarla yeniden açar. Pasif/tükenmiş ürünler eklenmez ve müşteriye söylenir.
 * Seçenek (ekstra) soruları yeniden sorulur, çünkü seçenekler ve fiyatları değişmiş olabilir. İşlendiyse true döner.
 * Müşterinin yarım bir siparişi varsa dokunmaz (o akış kendi sorusunu tekrarlar).
 */
export async function repeatOrderIfAsked(db: PrismaClient, cloud: WhatsappCloudClient | null, brand: Brand, customer: Customer, message: Message, now = new Date()): Promise<boolean> {
  try {
    if (message.type !== "text" || message.body.trim() !== "1") return false;
    const last0 = await findRepeatable(db, brand.id, customer.id);
    if (!last0) return false;
    if ((await brandOrderingState(db, brand, now)) === "closed") {
      await sendClosedNotice(db, cloud, brand, customer);
      return true;
    }
    const open = await db.order.findFirst({
      where: { brandId: brand.id, customerId: customer.id, status: "NEW", stage: { in: ["AWAITING_OPTIONS", "AWAITING_PAYMENT", "AWAITING_ADDRESS"] }, createdAt: { gte: new Date(now.getTime() - OPEN_ORDER_WINDOW_MS) } },
    });
    if (open) return false;
    const last = last0;

    const waMessageId = `tekrar:${message.id}`;
    if (await db.order.findUnique({ where: { waMessageId } })) return true; // aynı mesaj yeniden işlenmesin

    const products = await db.product.findMany({ where: { brandId: brand.id, id: { in: last.items.map((i) => i.productId).filter((id): id is number => id !== null) } } });
    const byId = new Map(products.map((p) => [p.id, p]));
    const kept: { productId: number; retailerId: string; name: string; unitKurus: number; quantity: number; oldKurus: number }[] = [];
    const dropped: string[] = [];
    for (const i of last.items) {
      const p = i.productId !== null ? byId.get(i.productId) : undefined;
      if (!p || availabilityOf({ status: p.status as ProductStatus, soldOutUntil: p.soldOutUntil }, now) !== "IN_STOCK") {
        dropped.push(i.name);
        continue;
      }
      kept.push({ productId: p.id, retailerId: p.retailerId, name: p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name, unitKurus: p.priceKurus, quantity: i.quantity, oldKurus: i.unitKurus });
    }

    const send = async (body: string) => {
      if (!cloud || !brand.waPhoneNumberId || !customer.waId) return;
      try {
        const id = await cloud.sendText(brand.waPhoneNumberId, customer.waId, body);
        await recordOutbound(db, { brandId: brand.id, customerId: customer.id, type: "text", body, waMessageId: id });
      } catch (err) {
        logger.warn({ err: (err as Error).message }, "Tekrar sipariş mesajı gönderilemedi");
      }
    };

    if (!kept.length) {
      await send(`Son siparişinizdeki ürünler şu an satışta değil (${dropped.join(", ")}). Güncel menü için katalogdan sipariş verebilirsiniz.`);
      return true;
    }

    const total = kept.reduce((s, k) => s + k.unitKurus * k.quantity, 0);
    const minKurus = await getMinBasket(db, brand.code);
    if (minKurus > 0 && total < minKurus) {
      await sendMinBasketNotice(db, cloud, brand, customer, total, minKurus);
      return true;
    }

    const stage = (await needsOptions(db, kept.map((k) => k.productId))) ? "AWAITING_OPTIONS" : "AWAITING_PAYMENT";
    const order = await db.order.create({
      data: {
        brandId: brand.id,
        customerId: customer.id,
        waMessageId,
        stage,
        totalKurus: total,
        items: { create: kept.map((k) => ({ productId: k.productId, retailerId: k.retailerId, name: k.name, unitKurus: k.unitKurus, quantity: k.quantity })) },
      },
    });
    await db.message.update({ where: { id: message.id }, data: { orderId: order.id } });

    const lines = kept.map((k) => `• ${k.quantity}× ${k.name} — ${formatTRY(k.unitKurus * k.quantity)}`);
    const changed = kept.some((k) => k.unitKurus !== k.oldKurus);
    const body = [
      `Son siparişinizi tekrarladık (No: ${order.id}):`,
      lines.join("\n"),
      `Ürün toplamı: ${formatTRY(order.totalKurus)}`,
      changed ? "Fiyatlar güncel menü fiyatlarıyla hesaplandı." : "",
      dropped.length ? `Şu ürünler şu an satışta olmadığı için eklenmedi: ${dropped.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    await send(body);
    await startOrderConversation(db, cloud, order.id);
    return true;
  } catch (err) {
    logger.warn({ err: (err as Error).message, messageId: message.id }, "Son sipariş tekrarlanamadı");
    return false;
  }
}
