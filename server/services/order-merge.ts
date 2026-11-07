import type { Order, PrismaClient } from "@prisma/client";
import { formatTRY } from "../../shared/money";
import { describeOptions } from "./option-format";
import { recalc } from "./order-edit";

/** Müşteri sipariş verdikten sonra yeni sepet gönderirse, ürünler bu durumlardaki siparişine eklenebilir (yola çıkmadan önce). */
export const MERGE_TARGET_STATUSES = ["NEW", "PREPARING"];
/** Bundan eski sipariş "açık" sayılmaz (personelin kapatmayı unuttuğu dünkü sipariş ekleme hedefi olmasın). */
export const MERGE_WINDOW_MS = 3 * 60 * 60 * 1000;

/** Müşterinin bu markadaki, adımlarını tamamlamış ve henüz yola çıkmamış en yeni siparişi (yoksa null). */
export async function findMergeTarget(db: PrismaClient, brandId: number, customerId: number, excludeOrderId: number | null, now = new Date()): Promise<Order | null> {
  return db.order.findFirst({
    where: {
      brandId,
      customerId,
      status: { in: MERGE_TARGET_STATUSES },
      stage: "READY",
      createdAt: { gte: new Date(now.getTime() - MERGE_WINDOW_MS) },
      ...(excludeOrderId !== null ? { id: { not: excludeOrderId } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export interface MergeResult {
  /** Eklenen kalemler, "1× Ayran (30 cl)" biçiminde */
  added: string[];
}

/**
 * Yeni sepetin kalemlerini (seçenekleriyle) hedef siparişe taşır, sepetin yazışma kayıtlarını hedefe bağlar ve boş kalan sepet siparişini siler.
 * Kalemler ayrı satır olarak eklenir ve "sonradan eklendi" diye işaretlenir; hedef panelde "ürün eklendi" uyarısı verir.
 * Hedef artık uygun değilse (yola çıktı, iptal edildi) hiçbir şey değiştirmez ve null döner.
 */
export async function mergeOrderInto(db: PrismaClient, sourceId: number, targetId: number, now = new Date()): Promise<MergeResult | null> {
  const result = await db.$transaction(async (tx) => {
    const target = await tx.order.findUnique({ where: { id: targetId } });
    const source = await tx.order.findUnique({ where: { id: sourceId }, include: { items: { orderBy: { id: "asc" }, include: { options: { orderBy: { id: "asc" } } } } } });
    if (!target || !source || target.id === source.id) return null;
    if (!MERGE_TARGET_STATUSES.includes(target.status) || target.stage !== "READY") return null;
    if (source.status !== "NEW" || source.brandId !== target.brandId || source.customerId !== target.customerId) return null;

    const added: string[] = [];
    for (const item of source.items) {
      await tx.orderItem.update({ where: { id: item.id }, data: { orderId: target.id, addedAt: now } });
      const opts = describeOptions(item.options);
      added.push(`${item.quantity}× ${item.name}${opts.length ? ` (${opts.join(", ")})` : ""}`);
    }
    // Sepet mesajı yazışmada artık var olmayan siparişi göstermesin
    await tx.message.updateMany({ where: { orderId: source.id, direction: "IN", type: "order" }, data: { body: `Ek sepet · ${formatTRY(source.totalKurus)} → Sipariş #${target.id}` } });
    await tx.message.updateMany({ where: { orderId: source.id }, data: { orderId: target.id } });
    for (const line of added) await tx.orderChange.create({ data: { orderId: target.id, text: `Müşteri WhatsApp'tan ekledi: ${line}`.slice(0, 300) } });
    await tx.order.delete({ where: { id: source.id } });
    await tx.order.update({ where: { id: target.id }, data: { addedPending: true } });
    return { added };
  });
  if (result) await recalc(db, targetId); // toplam, ödeme şekli indirimi ve kampanya eklenen ürünlerle yeniden
  return result;
}
