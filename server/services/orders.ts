import type { Order, PrismaClient } from "@prisma/client";
import { formatTRY } from "../../shared/money";
import { logger } from "../lib/logger";
import { contactFrom, upsertCustomer } from "./customers";
import { needsOptions } from "./options";
import { parseCloudOrder } from "./whatsapp-cloud";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export const ORDER_STATUSES = ["NEW", "PREPARING", "ON_THE_WAY", "DELIVERED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type IngestResult = { status: "created"; order: Order } | { status: "duplicate" } | { status: "skipped"; reason: string };

/**
 * Kaydedilmiş bir Cloud API sipariş olayını (webhook olay gövdesi) siparişe çevirir.
 * Marka, mesajın geldiği numaranın kimliğinden (metadata.phone_number_id) bulunur.
 * Aynı mesaj yeniden gelirse ikinci sipariş açılmaz.
 */
export async function ingestCloudOrder(db: PrismaClient, eventBody: string): Promise<IngestResult> {
  let body: { metadata?: { phone_number_id?: unknown }; message?: { id?: unknown } };
  try {
    body = JSON.parse(eventBody);
  } catch {
    return { status: "skipped", reason: "olay gövdesi okunamadı" };
  }
  const parsed = parseCloudOrder(body.message);
  const waMessageId = str(body.message?.id);
  if (!parsed || !waMessageId) return { status: "skipped", reason: "sipariş ayrıştırılamadı" };

  const phoneNumberId = str(body.metadata?.phone_number_id);
  const brand = phoneNumberId ? await db.brand.findFirst({ where: { waPhoneNumberId: phoneNumberId } }) : null;
  if (!brand) return { status: "skipped", reason: `numara kimliği (${phoneNumberId ?? "yok"}) hiçbir markaya bağlı değil (Markalar sayfası)` };

  const contact = contactFrom(body);
  if (!contact.waId && !contact.bsuid) return { status: "skipped", reason: "müşteri kimliği yok" };

  if (await db.order.findUnique({ where: { waMessageId } })) return { status: "duplicate" };

  const products = await db.product.findMany({ where: { brandId: brand.id, retailerId: { in: parsed.items.map((i) => i.retailerId) } } });
  const byRetailerId = new Map(products.map((p) => [p.retailerId, p]));

  // Ürünlerden birine seçenek grubu bağlıysa önce seçenek soruları sorulur
  const stage = (await needsOptions(db, products.map((p) => p.id))) ? "AWAITING_OPTIONS" : "AWAITING_PAYMENT";

  try {
    const order = await db.$transaction(async (tx) => {
      const customer = await upsertCustomer(tx, contact);

      const created = await tx.order.create({
        data: {
          brandId: brand.id,
          customerId: customer.id,
          waMessageId,
          // Yeni sepet önce müşteriden ödeme/adres bilgisi toplar; tamamlanınca HAZIR olur ve panelde sesli uyarı verir
          stage,
          note: parsed.note,
          totalKurus: parsed.totalKurus,
          items: {
            create: parsed.items.map((i) => {
              const p = byRetailerId.get(i.retailerId);
              const name = p ? (p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name) : `${i.retailerId} (katalogda bulunamadı)`;
              return { productId: p?.id ?? null, retailerId: i.retailerId, name, unitKurus: i.unitKurus, quantity: i.quantity };
            }),
          },
        },
      });
      // Yazışma akışında sipariş de bir mesaj olarak görünür
      await tx.message.create({
        data: { brandId: brand.id, customerId: customer.id, direction: "IN", type: "order", body: `Sipariş #${created.id} · ${formatTRY(created.totalKurus)}`, waMessageId, status: "RECEIVED", orderId: created.id },
      });
      return created;
    });
    return { status: "created", order };
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return { status: "duplicate" }; // eşzamanlı ikinci istek
    logger.error({ err }, "sipariş kaydedilemedi");
    throw err;
  }
}
