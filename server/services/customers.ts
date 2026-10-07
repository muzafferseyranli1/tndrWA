import type { Customer, Prisma, PrismaClient } from "@prisma/client";

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

/**
 * Müşteriyi telefon (wa_id) ya da Meta kullanıcı kimliğiyle bulur, yoksa oluşturur.
 * Profil adı yalnızca kayıtlı ad yoksa yazılır, yani elle girilmiş/içe aktarılmış ad ezilmez.
 */
export async function upsertCustomer(db: PrismaClient | Prisma.TransactionClient, contact: CloudContact): Promise<Customer> {
  const existing =
    (contact.waId ? await db.customer.findUnique({ where: { waId: contact.waId } }) : null) ??
    (contact.bsuid ? await db.customer.findUnique({ where: { bsuid: contact.bsuid } }) : null);
  if (!existing) return db.customer.create({ data: { waId: contact.waId, bsuid: contact.bsuid, name: contact.name } });
  return db.customer.update({
    where: { id: existing.id },
    data: { name: existing.name ?? contact.name, waId: existing.waId ?? contact.waId, bsuid: existing.bsuid ?? contact.bsuid },
  });
}
