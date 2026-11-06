import type { OptionChoice, OptionGroup, OrderItem, PrismaClient } from "@prisma/client";
import { recalc } from "./order-edit";

/** WhatsApp seçim listesi en fazla 10 satır alır: 9 seçenek + "Hiçbiri"/"Bitti". */
export const MAX_CHOICES = 9;
/** Çoklu seçimde seçilenler tek kayıtta bu ayraçla tutulur ("Domates + Sucuk"). */
export const MULTI_SEPARATOR = " + ";

type GroupWithChoices = OptionGroup & { choices: OptionChoice[] };

/**
 * Sıradaki soru:
 * - gate: kalemin isteğe bağlı seçenekleri var, önce "olduğu gibi mi, seçenekleri mi görmek istersiniz?" sorulur
 * - group: bir grubun seçim listesi (çoklu seçimde şimdiye kadar seçilenlerle birlikte)
 */
export type Question = { kind: "gate"; item: OrderItem; groups: GroupWithChoices[] } | { kind: "group"; item: OrderItem; group: GroupWithChoices; picked: string[] };

const pickedOf = (choiceName: string | undefined) => (choiceName ? choiceName.split(MULTI_SEPARATOR) : []);

/** Bu ürünlerden en az birine, sorulabilir (açık ve en az bir açık seçeneği olan) bir grup bağlı mı? */
export async function needsOptions(db: PrismaClient, productIds: number[]): Promise<boolean> {
  if (!productIds.length) return false;
  const n = await db.productOptionGroup.count({ where: { productId: { in: productIds }, group: { enabled: true, choices: { some: { enabled: true } } } } });
  return n > 0;
}

async function linksOf(db: PrismaClient, productId: number) {
  return db.productOptionGroup.findMany({
    where: { productId, group: { enabled: true, choices: { some: { enabled: true } } } },
    include: { group: { include: { choices: { where: { enabled: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], take: MAX_CHOICES } } } },
    orderBy: [{ group: { sortOrder: "asc" } }, { groupId: "asc" }],
  });
}

/**
 * Siparişte yanıt bekleyen ilk soru (kalem sırasıyla, kalemin grup sırasıyla). Kalmadıysa null.
 * Zorunlu gruplar her zaman sorulur; isteğe bağlı gruplardan önce kalem başına bir kez "değişiklik ister misiniz?" sorulur,
 * müşteri "olduğu gibi" derse o kalemin isteğe bağlı grupları atlanır.
 */
export async function nextQuestion(db: PrismaClient, orderId: number): Promise<Question | null> {
  const items = await db.orderItem.findMany({ where: { orderId }, orderBy: { id: "asc" }, include: { options: true } });
  for (const item of items) {
    if (!item.productId) continue;
    const links = await linksOf(db, item.productId);
    const optional = links.filter((l) => !l.group.required).map((l) => l.group);
    for (const { group } of links) {
      const answer = item.options.find((o) => o.groupId === group.id);
      if (answer?.complete) continue;
      if (!group.required) {
        if (item.optionsWanted === false) continue;
        if (item.optionsWanted === null) return { kind: "gate", item, groups: optional };
      }
      return { kind: "group", item, group, picked: pickedOf(answer?.choiceName) };
    }
  }
  return null;
}

export type AnswerResult = { ok: true } | { ok: false; reason: string };

/** "Olduğu gibi" (false) ya da "Seçenekleri göster" (true). Yalnızca henüz cevaplanmamış kalemde geçerli. */
export async function applyGate(db: PrismaClient, orderId: number, itemId: number, wanted: boolean): Promise<AnswerResult> {
  const n = await db.orderItem.updateMany({ where: { id: itemId, orderId, optionsWanted: null }, data: { optionsWanted: wanted } });
  return n.count ? { ok: true } : { ok: false, reason: "kalem bulunamadı ya da zaten yanıtlandı" };
}

/**
 * Müşterinin cevabını kaydeder. choiceId 0: tek seçimde "Hiçbiri" (yalnız isteğe bağlı grupta), çoklu seçimde "Bitti".
 * Çoklu seçimde her seçim eklenir; sınıra ya da seçeneklerin sonuna gelince grup tamamlanır.
 * Geçersiz/eski cevaplar reddedilir. Kalemin ekstra ücreti ve siparişin toplamı yeniden hesaplanır.
 */
export async function applyAnswer(db: PrismaClient, orderId: number, itemId: number, groupId: number, choiceId: number): Promise<AnswerResult> {
  const item = await db.orderItem.findFirst({ where: { id: itemId, orderId } });
  if (!item || !item.productId) return { ok: false, reason: "kalem bulunamadı" };
  const link = await db.productOptionGroup.findFirst({ where: { productId: item.productId, groupId, group: { enabled: true } }, include: { group: { include: { choices: { where: { enabled: true } } } } } });
  if (!link) return { ok: false, reason: "bu ürüne bağlı değil" };
  const { group } = link;
  const key = { orderItemId_groupId: { orderItemId: itemId, groupId } };
  const existing = await db.orderItemOption.findUnique({ where: key });

  let choice: OptionChoice | null = null;
  if (choiceId !== 0) {
    choice = group.choices.find((c) => c.id === choiceId) ?? null;
    if (!choice) return { ok: false, reason: "seçenek geçersiz" };
  }

  if (group.maxSelect <= 1) {
    if (!choice && group.required) return { ok: false, reason: "bu soru zorunlu" };
    const data = { groupId, groupName: group.name, choiceName: choice?.name ?? "", extraKurus: choice?.extraKurus ?? 0, complete: true };
    await db.orderItemOption.upsert({ where: key, create: { orderItemId: itemId, ...data }, update: data });
  } else {
    if (existing?.complete) return { ok: false, reason: "zaten tamamlandı" };
    const picked = pickedOf(existing?.choiceName);
    let extra = existing?.extraKurus ?? 0;
    if (!choice) {
      if (group.required && picked.length === 0) return { ok: false, reason: "bu soru zorunlu" };
    } else if (!picked.includes(choice.name)) {
      picked.push(choice.name);
      extra += choice.extraKurus;
    }
    const limit = Math.min(group.maxSelect, Math.min(group.choices.length, MAX_CHOICES));
    const complete = !choice || picked.length >= limit;
    const data = { groupId, groupName: group.name, choiceName: picked.join(MULTI_SEPARATOR), extraKurus: extra, complete };
    await db.orderItemOption.upsert({ where: key, create: { orderItemId: itemId, ...data }, update: data });
  }

  const sum = await db.orderItemOption.aggregate({ where: { orderItemId: itemId }, _sum: { extraKurus: true } });
  await db.orderItem.update({ where: { id: itemId }, data: { extraKurus: sum._sum.extraKurus ?? 0 } });
  await recalc(db, orderId);
  return { ok: true };
}
