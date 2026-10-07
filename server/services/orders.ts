import type { Order, PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";
import { parseCloudOrder } from "./whatsapp-cloud";

export const ORDER_STATUSES = ["NEW", "PREPARING", "ON_THE_WAY", "DELIVERED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface CloudContact {
  waId: string | null;
  bsuid: string | null;
  name: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Webhook gövdesinden (kaydedilen olay biçimi) müşteri bilgisi: telefon, Meta kullanıcı kimliği ve profil adı. */
export function contactFrom(body: unknown): CloudContact {
  const b = body as { contacts?: { profile?: { name?: unknown }; wa_id?: unknown; user_id?: unknown }[]; message?: { from?: unknown; from_user_id?: unknown } } | null;
  const c = b?.contacts?.[0];
  return {
    waId: str(c?.wa_id) ?? str(b?.message?.from),
    bsuid: str(c?.user_id) ?? str(b?.message?.from_user_id),
    name: str(c?.profile?.name),
  };
}

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

  try {
    const order = await db.$transaction(async (tx) => {
      const existing =
        (contact.waId ? await tx.customer.findUnique({ where: { waId: contact.waId } }) : null) ??
        (contact.bsuid ? await tx.customer.findUnique({ where: { bsuid: contact.bsuid } }) : null);
      const customer = existing
        ? await tx.customer.update({ where: { id: existing.id }, data: { name: contact.name ?? existing.name, waId: existing.waId ?? contact.waId, bsuid: existing.bsuid ?? contact.bsuid } })
        : await tx.customer.create({ data: { waId: contact.waId, bsuid: contact.bsuid, name: contact.name } });

      return tx.order.create({
        data: {
          brandId: brand.id,
          customerId: customer.id,
          waMessageId,
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
    });
    return { status: "created", order };
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return { status: "duplicate" }; // eşzamanlı ikinci istek
    logger.error({ err }, "sipariş kaydedilemedi");
    throw err;
  }
}
