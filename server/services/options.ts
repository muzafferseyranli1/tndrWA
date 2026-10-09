import type { OptionChoice, OptionGroup, OrderItem, PrismaClient } from "@prisma/client";
import { recalc } from "./order-edit";

/** WhatsApp seçim listesi en fazla 10 satır alır: 9 seçenek + "Hiçbiri". */
export const MAX_CHOICES = 9;

type GroupWithChoices = OptionGroup & { choices: OptionChoice[] };

export interface Question {
  item: OrderItem;
  group: GroupWithChoices;
}

/** Bu ürünlerden en az birine, sorulabilir (açık ve en az bir açık seçeneği olan) bir grup bağlı mı? */
export async function needsOptions(db: PrismaClient, productIds: number[]): Promise<boolean> {
  if (!productIds.length) return false;
  const n = await db.productOptionGroup.count({ where: { productId: { in: productIds }, group: { enabled: true, choices: { some: { enabled: true } } } } });
  return n > 0;
}

/** Siparişte yanıt bekleyen ilk soru (kalem sırasıyla, kalemin grup sırasıyla). Kalmadıysa null. */
export async function nextQuestion(db: PrismaClient, orderId: number): Promise<Question | null> {
  const items = await db.orderItem.findMany({ where: { orderId }, orderBy: { id: "asc" }, include: { options: true } });
  for (const item of items) {
    if (!item.productId) continue;
    const links = await db.productOptionGroup.findMany({
      where: { productId: item.productId, group: { enabled: true, choices: { some: { enabled: true } } } },
      include: { group: { include: { choices: { where: { enabled: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], take: MAX_CHOICES } } } },
      orderBy: [{ group: { sortOrder: "asc" } }, { groupId: "asc" }],
    });
    for (const link of links) {
      if (!item.options.some((o) => o.groupId === link.groupId)) return { item, group: link.group };
    }
  }
  return null;
}

export type AnswerResult = { ok: true } | { ok: false; reason: string };

/**
 * Müşterinin cevabını kaydeder (choiceId 0 = "Hiçbiri", yalnızca zorunlu olmayan gruplarda).
 * Geçersiz/eski cevaplar reddedilir. Kalemin ekstra ücreti ve siparişin toplamı yeniden hesaplanır.
 */
export async function applyAnswer(db: PrismaClient, orderId: number, itemId: number, groupId: number, choiceId: number): Promise<AnswerResult> {
  const item = await db.orderItem.findFirst({ where: { id: itemId, orderId } });
  if (!item || !item.productId) return { ok: false, reason: "kalem bulunamadı" };
  const link = await db.productOptionGroup.findFirst({ where: { productId: item.productId, groupId, group: { enabled: true } }, include: { group: true } });
  if (!link) return { ok: false, reason: "bu ürüne bağlı değil" };
  let choice: OptionChoice | null = null;
  if (choiceId === 0) {
    if (link.group.required) return { ok: false, reason: "bu soru zorunlu" };
  } else {
    choice = await db.optionChoice.findFirst({ where: { id: choiceId, groupId, enabled: true } });
    if (!choice) return { ok: false, reason: "seçenek geçersiz" };
  }
  const data = { groupId, groupName: link.group.name, choiceName: choice?.name ?? "", extraKurus: choice?.extraKurus ?? 0 };
  await db.orderItemOption.upsert({ where: { orderItemId_groupId: { orderItemId: itemId, groupId } }, create: { orderItemId: itemId, ...data }, update: data });
  const sum = await db.orderItemOption.aggregate({ where: { orderItemId: itemId }, _sum: { extraKurus: true } });
  await db.orderItem.update({ where: { id: itemId }, data: { extraKurus: sum._sum.extraKurus ?? 0 } });
  await recalc(db, orderId);
  return { ok: true };
}
