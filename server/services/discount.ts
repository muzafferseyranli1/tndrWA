import type { Prisma, PrismaClient } from "@prisma/client";
import { computeDiscount, etTandirCampaignApplies, type DiscountInput, type DiscountResult } from "../../shared/campaigns";

type Db = PrismaClient | Prisma.TransactionClient;

async function discountInput(db: Db, orderId: number, paymentPercent: number): Promise<DiscountInput> {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { brand: true, items: true } });
  const ids = order.items.map((i) => i.productId).filter((id): id is number => id !== null);
  const products = ids.length ? await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, category: { select: { name: true } } } }) : [];
  const categoryOf = new Map(products.map((p) => [p.id, p.category.name]));
  return {
    brandCode: order.brand.code,
    createdAt: order.createdAt,
    paymentPercent,
    items: order.items.map((i) => ({ unitKurus: i.unitKurus, extraKurus: i.extraKurus, quantity: i.quantity, categoryName: i.productId !== null ? (categoryOf.get(i.productId) ?? null) : null })),
  };
}

/** Siparişin indirimini (ödeme şekli oranı + kodda tanımlı kampanyalar) hesaplar; kaydetmez. */
export async function orderDiscount(db: Db, orderId: number, paymentPercent: number): Promise<DiscountResult> {
  return computeDiscount(await discountInput(db, orderId, paymentPercent));
}

/** Ödeme şekli seçilmeden önce: indirimli ödemeyle kampanya bu siparişe uygulanır mı (müşteriye haber vermek için). */
export async function orderCampaignAvailable(db: Db, orderId: number): Promise<boolean> {
  return etTandirCampaignApplies(await discountInput(db, orderId, 0));
}
