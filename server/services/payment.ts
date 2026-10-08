import type { PrismaClient } from "@prisma/client";
import { percentOf } from "../../shared/money";

interface DefaultPayment {
  name: string;
  discountPercent: number;
  enabled: boolean;
}

/** Yeni markalara eklenen varsayılan ödeme şekilleri. Panelden açılıp kapatılır, adı ve oranı değiştirilir. */
export const DEFAULT_PAYMENT_TYPES: DefaultPayment[] = [
  { name: "Nakit", discountPercent: 15, enabled: true },
  { name: "Kapıda kredi kartı", discountPercent: 15, enabled: true },
  { name: "Edenred", discountPercent: 0, enabled: true },
  { name: "Multinet", discountPercent: 0, enabled: false },
  { name: "Sodexo", discountPercent: 0, enabled: false },
  { name: "Metropol", discountPercent: 0, enabled: false },
  { name: "Ticket", discountPercent: 0, enabled: false },
];

/** Ödeme şekli kaydı olmayan markalara varsayılanları ekler (kayıt varsa dokunmaz). */
export async function ensureDefaultPaymentTypes(db: PrismaClient): Promise<number> {
  const brands = await db.brand.findMany({ include: { _count: { select: { paymentTypes: true } } } });
  let created = 0;
  for (const brand of brands) {
    if (brand._count.paymentTypes > 0) continue;
    for (const [index, p] of DEFAULT_PAYMENT_TYPES.entries()) {
      await db.paymentType.create({ data: { brandId: brand.id, name: p.name, discountPercent: p.discountPercent, enabled: p.enabled, sortOrder: index } });
      created++;
    }
  }
  return created;
}

/** İndirim, liste fiyatı toplamı üzerinden hesaplanır. */
export function priceWithDiscount(totalKurus: number, discountPercent: number): { discountKurus: number; payableKurus: number } {
  const discountKurus = discountPercent > 0 ? percentOf(totalKurus, discountPercent) : 0;
  return { discountKurus, payableKurus: totalKurus - discountKurus };
}
