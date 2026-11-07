import type { Brand, Customer, Message, Order, PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";
import { formatTRY } from "../../shared/money";
import { markNoticeSent, noticeLine, policyUrl } from "./notice";
import { rememberAddress } from "./addresses";
import { applyAnswer, applyGate, needsOptions, nextQuestion, type Question } from "./options";
import { orderVars, renderTemplate, templateFor, type MessageKey, type TemplateVars } from "./order-messages";
import { recordFailedOutbound, recordOutbound } from "./outbound";
import { orderCampaignAvailable, orderDiscount } from "./discount";
import { ET_TANDIR_CAMPAIGN } from "../../shared/campaigns";
import { getMinBasket, sendMinBasketNotice } from "./hours";
import { itemLines } from "./order-edit";
import { findMergeTarget, mergeOrderInto } from "./order-merge";
import type { WhatsappCloudClient } from "./whatsapp-cloud";

/** Müşteri bu süreden sonra yazarsa eski yarım sipariş artık beklemede sayılmaz (personel elle tamamlar). */
export const OPEN_ORDER_WINDOW_MS = 3 * 60 * 60 * 1000;
const ADDRESS_MIN_LENGTH = 8;

type FullOrder = Order & { brand: Brand; customer: Customer };

/** Düğme/liste yanıtlarının kimlikleri: kimlik hangi siparişe ait olduğunu da taşır, böylece eski mesajdaki düğme yanlış siparişe işlemez. */
export const payId = (orderId: number, paymentTypeId: number) => `pay:${orderId}:${paymentTypeId}`;
export const addrId = (orderId: number, choice: number | "new") => `addr:${orderId}:${choice}`;
export const optId = (orderId: number, itemId: number, groupId: number, choiceId: number) => `opt:${orderId}:${itemId}:${groupId}:${choiceId}`;
/** "Olduğu gibi" / "Seçenekleri göster" düğmeleri */
export const gateId = (orderId: number, itemId: number, wanted: boolean) => `optg:${orderId}:${itemId}:${wanted ? "yes" : "no"}`;
export const kvkkId = (orderId: number, choice: "ok" | "text") => `kvkk:${orderId}:${choice}`;
/** "Siparişime ekle" / "Ayrı sipariş" düğmeleri (yeni sepet, yola çıkmamış açık sipariş varken) */
export const mergeId = (orderId: number, choice: "yes" | "no") => `merge:${orderId}:${choice}`;

/** Müşteriden yanıt beklenen aşamalar (açık siparişe ekleme, KVKK bilgilendirme onayı, seçenek, ödeme, adres). */
export const WAITING_STAGES = ["AWAITING_MERGE", "AWAITING_NOTICE", "AWAITING_OPTIONS", "AWAITING_PAYMENT", "AWAITING_ADDRESS"];
/** Müşteri "ekle" dedi ama sipariş bu arada yola çıktı */
const MERGE_LATE_TEXT = "Önceki siparişiniz yola çıktığı için bu ürünleri ona ekleyemedik; ayrı sipariş olarak devam ediyoruz.";
/** "Okudum, devam" butonu yerine yazıyla onay */
const ACK_TEXT = /^(okudum|tamam|onay(l[ıi]yorum)?|devam|evet|ok)\b/i;
const NOTICE_STEP_KEY = "kvkk.noticeStep";

/** İlk siparişte KVKK bilgilendirme onayı sorulsun mu (İşletme/KVKK sayfasından kapatılabilir; varsayılan açık). */
export async function noticeStepEnabled(db: PrismaClient): Promise<boolean> {
  return (await db.setting.findUnique({ where: { key: NOTICE_STEP_KEY } }))?.value !== "off";
}

export async function setNoticeStep(db: PrismaClient, enabled: boolean): Promise<void> {
  await db.setting.upsert({ where: { key: NOTICE_STEP_KEY }, create: { key: NOTICE_STEP_KEY, value: enabled ? "on" : "off" }, update: { value: enabled ? "on" : "off" } });
}

export { addressKey, rememberAddress } from "./addresses";

async function load(db: PrismaClient, orderId: number): Promise<FullOrder | null> {
  return db.order.findUnique({ where: { id: orderId }, include: { brand: true, customer: true } });
}

function canSend(cloud: WhatsappCloudClient | null, o: FullOrder): cloud is WhatsappCloudClient {
  return !!cloud && !!o.brand.waPhoneNumberId && !!o.customer.waId;
}

async function render(db: PrismaClient, o: FullOrder, key: MessageKey, extra: TemplateVars = {}): Promise<string> {
  return renderTemplate(await templateFor(db, o.brand.code, key), { ...orderVars(o, o.customer), ...extra });
}

async function log(db: PrismaClient, o: FullOrder, type: "text" | "catalog", body: string, id: string | null) {
  await recordOutbound(db, { brandId: o.brandId, customerId: o.customerId, type, body, waMessageId: id, orderId: o.id });
  // Müşteriye soru gitti: yanıt bekleme süresi buradan başlar (yanıt gelmezse hatırlatma, sonra iptal; bkz. order-timeouts)
  await db.order.update({ where: { id: o.id }, data: { promptedAt: new Date(), reminderSentAt: null } });
}

/** Müşterinin yanıt vermediği soruyu (seçenek, ödeme ya da adres) yeniden gönderir. */
export async function resendPendingQuestion(db: PrismaClient, cloud: WhatsappCloudClient | null, orderId: number): Promise<void> {
  const order = await load(db, orderId);
  if (!order || order.status !== "NEW") return;
  if (order.stage === "AWAITING_MERGE" || order.stage === "AWAITING_NOTICE" || order.stage === "AWAITING_OPTIONS" || order.stage === "AWAITING_PAYMENT") return startOrderConversation(db, cloud, orderId);
  if (order.stage === "AWAITING_ADDRESS") return askAddress(db, cloud, order);
}

/**
 * Siparişin bir sonraki adımını müşteriye sorar: önce (varsa) seçenek soruları, sonra ödeme şekli (kayıtlı ödeme şekli yoksa doğrudan adres).
 * Aynı adımı tekrar sormak güvenlidir (müşteri yazı yazarsa ya da eski bir düğmeye basarsa çağrılır).
 */
export async function startOrderConversation(db: PrismaClient, cloud: WhatsappCloudClient | null, orderId: number): Promise<void> {
  try {
    let order = await load(db, orderId);
    if (!order || order.stage === "READY") return;
    if (order.stage === "AWAITING_MERGE") return await askMerge(db, cloud, order);

    // İlk siparişte KVKK bilgilendirmesi: müşteri "Okudum, devam" deyince sipariş adımları başlar (bir kez sorulur)
    if (order.stage !== "AWAITING_ADDRESS" && !order.customer.noticeAckAt && policyUrl() && (await noticeStepEnabled(db))) {
      if (order.stage !== "AWAITING_NOTICE") await db.order.update({ where: { id: order.id }, data: { stage: "AWAITING_NOTICE" } });
      return await askNotice(db, cloud, (await load(db, orderId))!);
    }
    if (order.stage === "AWAITING_NOTICE") {
      await db.order.update({ where: { id: order.id }, data: { stage: await firstStage(db, order.id) } });
      order = (await load(db, orderId))!;
    }

    if (order.stage === "AWAITING_OPTIONS") {
      const question = await nextQuestion(db, order.id);
      if (question) return await askOption(db, cloud, order, question);
      if (order.mergeIntoId) return await completeMerge(db, cloud, order); // "Siparişime ekle": seçenekler bitti, ürünler açık siparişe taşınır
      await db.order.update({ where: { id: order.id }, data: { stage: "AWAITING_PAYMENT" } }); // soru kalmadı
      order = (await load(db, orderId))!;
    }

    const types = await db.paymentType.findMany({ where: { brandId: order.brandId, enabled: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], take: 10 });
    if (!types.length) {
      await db.order.update({ where: { id: order.id }, data: { stage: "AWAITING_ADDRESS" } });
      return askAddress(db, cloud, (await load(db, orderId))!);
    }
    await db.order.update({ where: { id: order.id }, data: { stage: "AWAITING_PAYMENT" } });
    if (!canSend(cloud, order)) return;
    const kvkk = await noticeLine(db, order.customer); // ilk temasta aydınlatma metni bağlantısı
    const base = await render(db, order, "NEW", { kvkk });
    // Kampanya bu sepete uygunsa ödeme sorusunda söylenir (nakit/kart seçilirse uygulanır)
    const body = (await orderCampaignAvailable(db, order.id)) ? `${base}

🎉 ${ET_TANDIR_CAMPAIGN.name}: nakit veya kapıda kredi kartıyla ödemede siparişinizdeki ${ET_TANDIR_CAMPAIGN.category} ürünlerine %${ET_TANDIR_CAMPAIGN.percent} indirim uygulanır.` : base;
    const id = await cloud.sendList(order.brand.waPhoneNumberId!, order.customer.waId!, {
      body,
      buttonText: "Ödeme şekli seç",
      rows: types.map((t) => ({ id: payId(order.id, t.id), title: t.name, description: t.discountPercent > 0 ? `%${t.discountPercent} indirimli` : undefined })),
    });
    await log(db, order, "text", body, id);
    if (kvkk) await markNoticeSent(db, order.customerId);
  } catch (err) {
    const o = await load(db, orderId).catch(() => null);
    if (o) await reportFailure(db, o, "Ödeme şekli sorusu", "", err);
    else logger.warn({ err: (err as Error).message, orderId }, "Ödeme sorusu gönderilemedi");
  }
}

/** Sepetin ilk adımı: ürünlerden birine seçenek grubu bağlıysa seçenek soruları, yoksa ödeme şekli. */
async function firstStage(db: PrismaClient, orderId: number): Promise<"AWAITING_OPTIONS" | "AWAITING_PAYMENT"> {
  const items = await db.orderItem.findMany({ where: { orderId }, select: { productId: true } });
  return (await needsOptions(db, items.map((i) => i.productId).filter((id): id is number => id !== null))) ? "AWAITING_OPTIONS" : "AWAITING_PAYMENT";
}

/**
 * Yeni sepet geldi: müşterinin yola çıkmamış açık siparişi varsa önce "Bu ürünleri siparişinize ekleyelim mi?" sorulur,
 * yoksa normal akış (seçenek, ödeme, adres) başlar.
 */
export async function offerMergeOrStart(db: PrismaClient, cloud: WhatsappCloudClient | null, orderId: number): Promise<void> {
  try {
    const order = await load(db, orderId);
    if (!order || order.status !== "NEW" || order.stage === "READY") return;
    if (canSend(cloud, order) && (await findMergeTarget(db, order.brandId, order.customerId, order.id))) {
      await db.order.update({ where: { id: order.id }, data: { stage: "AWAITING_MERGE" } });
      return await askMerge(db, cloud, (await load(db, orderId))!);
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, orderId }, "Siparişe ekleme denetlenemedi");
  }
  await startOrderConversation(db, cloud, orderId);
}

/** "Siparişime ekle" / "Ayrı sipariş" sorusu. Açık sipariş kalmadıysa (yola çıktı) ya da düğme gönderilemezse ayrı sipariş olarak devam edilir. */
async function askMerge(db: PrismaClient, cloud: WhatsappCloudClient | null, order: FullOrder): Promise<void> {
  const target = await findMergeTarget(db, order.brandId, order.customerId, order.id);
  if (!target) return continueSeparately(db, cloud, order);
  if (!canSend(cloud, order)) return;
  const items = await db.orderItem.findMany({ where: { orderId: order.id }, orderBy: { id: "asc" }, include: { options: { orderBy: { id: "asc" } } } });
  const body = renderTemplate(await templateFor(db, order.brand.code, "MERGE_ASK"), { ...orderVars(order, order.customer), no: target.id, urunler: itemLines(items) });
  try {
    const id = await cloud.sendButtons(order.brand.waPhoneNumberId!, order.customer.waId!, body, [
      { id: mergeId(order.id, "yes"), title: "Siparişime ekle ➕" },
      { id: mergeId(order.id, "no"), title: "Ayrı sipariş" },
    ]);
    await log(db, order, "text", body, id);
  } catch (err) {
    await reportFailure(db, order, "Siparişe ekleme sorusu", body, err);
    await continueSeparately(db, cloud, order);
  }
}

async function tell(db: PrismaClient, cloud: WhatsappCloudClient | null, order: FullOrder, text: string): Promise<void> {
  if (!canSend(cloud, order)) return;
  try {
    const id = await cloud.sendText(order.brand.waPhoneNumberId!, order.customer.waId!, text);
    await log(db, order, "text", text, id);
  } catch (err) {
    await reportFailure(db, order, "Bilgi mesajı", text, err);
  }
}

/** Ayrı sipariş: normal akış. Sepet tek başına minimum tutarın altındaysa (ekleme için kabul edilmişti) sipariş açılmaz. */
async function continueSeparately(db: PrismaClient, cloud: WhatsappCloudClient | null, order: FullOrder): Promise<void> {
  const minKurus = await getMinBasket(db, order.brand.code);
  if (minKurus > 0 && order.totalKurus < minKurus) {
    await db.order.update({ where: { id: order.id }, data: { status: "CANCELLED", mergeIntoId: null } });
    await db.orderChange.create({ data: { orderId: order.id, text: "Ayrı sipariş minimum sepet tutarının altında kaldı, otomatik iptal edildi" } });
    return sendMinBasketNotice(db, cloud, order.brand, order.customer, order.totalKurus, minKurus);
  }
  await db.order.update({ where: { id: order.id }, data: { stage: await firstStage(db, order.id), mergeIntoId: null } });
  await startOrderConversation(db, cloud, order.id);
}

async function answerMerge(db: PrismaClient, cloud: WhatsappCloudClient | null, order: FullOrder, add: boolean): Promise<void> {
  if (!add) return continueSeparately(db, cloud, order);
  const target = await findMergeTarget(db, order.brandId, order.customerId, order.id);
  if (!target) {
    await tell(db, cloud, order, MERGE_LATE_TEXT);
    return continueSeparately(db, cloud, order);
  }
  // Seçenekli ürün varsa önce sorular (sepette zaten mesaj olduğu için ilk soru "siparişinizi aldık" demez), bitince taşınır
  const options = (await firstStage(db, order.id)) === "AWAITING_OPTIONS";
  await db.order.update({ where: { id: order.id }, data: { mergeIntoId: target.id, ...(options ? { stage: "AWAITING_OPTIONS" } : {}) } });
  if (options) return startOrderConversation(db, cloud, order.id);
  return completeMerge(db, cloud, (await load(db, order.id))!);
}

/** Ürünleri açık siparişe taşır, müşteriye güncel özeti gönderir. Sipariş bu arada yola çıktıysa ayrı sipariş olarak devam eder. */
async function completeMerge(db: PrismaClient, cloud: WhatsappCloudClient | null, order: FullOrder): Promise<void> {
  const targetId = order.mergeIntoId;
  const merged = targetId ? await mergeOrderInto(db, order.id, targetId) : null;
  if (!targetId || !merged) {
    await tell(db, cloud, order, MERGE_LATE_TEXT);
    return continueSeparately(db, cloud, (await load(db, order.id))!);
  }
  const target = await db.order.findUnique({ where: { id: targetId }, include: { brand: true, customer: true, items: { orderBy: { id: "asc" }, include: { options: { orderBy: { id: "asc" } } } } } });
  if (!target || !canSend(cloud, target)) return;
  const body = renderTemplate(await templateFor(db, target.brand.code, "MERGE_DONE"), { ...orderVars(target, target.customer), urunler: itemLines(target.items) });
  try {
    const id = await cloud.sendText(target.brand.waPhoneNumberId!, target.customer.waId!, body);
    await recordOutbound(db, { brandId: target.brandId, customerId: target.customerId, type: "text", body, waMessageId: id, orderId: target.id });
  } catch (err) {
    await reportFailure(db, target, "Ekleme onayı", body, err);
  }
}

/** KVKK bilgilendirmesi: aydınlatma metni bağlantısı + "Okudum, devam" / "KVKK Metni" düğmeleri (düğme gönderilemezse yazıyla onay istenir). */
async function askNotice(db: PrismaClient, cloud: WhatsappCloudClient | null, order: FullOrder): Promise<void> {
  if (!canSend(cloud, order)) return;
  const phoneId = order.brand.waPhoneNumberId!;
  const to = order.customer.waId!;
  const body = await render(db, order, "KVKK_NOTICE", { link: policyUrl() ?? "" });
  try {
    const id = await cloud.sendButtons(phoneId, to, body, [
      { id: kvkkId(order.id, "ok"), title: "Okudum, devam ✅" },
      { id: kvkkId(order.id, "text"), title: "KVKK Metni 📄" },
    ]);
    await log(db, order, "text", body, id);
    await markNoticeSent(db, order.customerId);
  } catch (err) {
    await reportFailure(db, order, "KVKK bilgilendirmesi (düğme)", body, err);
    const text = `${body}\n\nDevam etmek için "okudum" yazmanız yeterli.`;
    try {
      const id = await cloud.sendText(phoneId, to, text);
      await log(db, order, "text", text, id);
      await markNoticeSent(db, order.customerId);
    } catch (err2) {
      await reportFailure(db, order, "KVKK bilgilendirmesi", text, err2);
    }
  }
}

/** "Okudum, devam": müşterinin bilgilendirmeyi okuduğu kaydedilir, sipariş adımlarına geçilir. */
async function acknowledgeNotice(db: PrismaClient, cloud: WhatsappCloudClient | null, order: FullOrder): Promise<void> {
  const now = new Date();
  await db.customer.update({ where: { id: order.customerId }, data: { noticeAckAt: now, noticeSentAt: order.customer.noticeSentAt ?? now } });
  await startOrderConversation(db, cloud, order.id);
}

/**
 * Bir seçenek sorusunu gönderir. İlk soruda "siparişinizi aldık" karşılaması ve (ilk temasta) aydınlatma bağlantısı eklenir.
 * - gate: "Olduğu gibi" / "Seçenekleri göster" düğmeleri (isteğe bağlı seçenekler yalnız istenirse sorulur)
 * - tek seçim: liste (+ isteğe bağlıysa "Hiçbiri")
 * - çoklu seçim: seçilmemişlerin listesi + "Bitti" (ilk seçimden önce isteğe bağlıysa "Hiçbiri"); her seçimde yeniden gelir
 */
async function askOption(db: PrismaClient, cloud: WhatsappCloudClient | null, order: FullOrder, question: Question): Promise<void> {
  if (!canSend(cloud, order)) return;
  const first = (await db.message.count({ where: { orderId: order.id, direction: "OUT" } })) === 0;
  const kvkk = first ? await noticeLine(db, order.customer) : "";
  const { item } = question;
  const what = `${item.name}${item.quantity > 1 ? ` (${item.quantity} adet)` : ""}`;
  const opening = first ? `Siparişinizi aldık (No: ${order.id}).` : "";
  const phoneId = order.brand.waPhoneNumberId!;
  const to = order.customer.waId!;

  if (question.kind === "gate") {
    const body = [opening, `${what} için değişiklik ister misiniz?\n(${question.groups.map((g) => g.name).join(", ")})`, kvkk].filter(Boolean).join("\n\n");
    try {
      const id = await cloud.sendButtons(phoneId, to, body, [
        { id: gateId(order.id, item.id, false), title: "Olduğu gibi ✅" },
        { id: gateId(order.id, item.id, true), title: "Seçenekleri göster" },
      ]);
      await log(db, order, "text", body, id);
      if (kvkk) await markNoticeSent(db, order.customerId);
    } catch (err) {
      await reportFailure(db, order, "Seçenek sorusu", body, err);
    }
    return;
  }

  const { group, picked } = question;
  const multi = group.maxSelect > 1;
  const ask = multi ? `${what} için "${group.name}" seçin (en fazla ${group.maxSelect}, bitince "Bitti"):` : `${what} için "${group.name}" seçin:`;
  const so = picked.length ? `Seçilenler: ${picked.join(", ")}` : "";
  const body = [opening, ask, so, kvkk].filter(Boolean).join("\n\n");
  const rows: { id: string; title: string; description?: string }[] = group.choices
    .filter((c) => !picked.includes(c.name))
    .map((c) => ({ id: optId(order.id, item.id, group.id, c.id), title: c.name, description: c.extraKurus > 0 ? `+${formatTRY(c.extraKurus)}` : undefined }));
  if (multi && picked.length) rows.push({ id: optId(order.id, item.id, group.id, 0), title: "Bitti ✅" });
  else if (!group.required) rows.push({ id: optId(order.id, item.id, group.id, 0), title: "Hiçbiri" });
  try {
    const id = await cloud.sendList(phoneId, to, { body, buttonText: "Seçim yap", rows });
    await log(db, order, "text", body, id);
    if (kvkk) await markNoticeSent(db, order.customerId);
  } catch (err) {
    await reportFailure(db, order, "Seçenek sorusu", body, err);
  }
}

/** Gönderilemeyen mesajı günlüğe ve yazışmaya (kırmızı "gitmedi" + sebep) kaydeder. */
async function reportFailure(db: PrismaClient, o: FullOrder, what: string, body: string, err: unknown): Promise<void> {
  const reason = (err as Error).message ?? String(err);
  logger.warn({ orderId: o.id, what, err: reason }, "Müşteriye mesaj gönderilemedi");
  await recordFailedOutbound(db, { brandId: o.brandId, customerId: o.customerId, type: "text", body, waMessageId: null, orderId: o.id }, `${what}: ${reason}`).catch(() => undefined);
}

/** Adres soru mesajı: kayıtlı adres(ler)e göre düğme/liste; olmazsa ya da gönderilemezse düz metinle adres ister (akış asla susmaz). */
async function askAddress(db: PrismaClient, cloud: WhatsappCloudClient | null, order: FullOrder): Promise<void> {
  if (!canSend(cloud, order)) return;
  const phoneId = order.brand.waPhoneNumberId!;
  const to = order.customer.waId!;
  const saved = await db.customerAddress.findMany({ where: { customerId: order.customerId }, orderBy: [{ lastUsedAt: "desc" }, { id: "desc" }], take: 9 });

  if (saved.length > 0) {
    let body = "";
    try {
      if (saved.length === 1) {
        body = renderTemplate(await templateFor(db, order.brand.code, "CONFIRM_ADDRESS"), { ...orderVars(order, order.customer), adres: saved[0].text });
        const id = await cloud.sendButtons(phoneId, to, body, [
          { id: addrId(order.id, saved[0].id), title: "Evet, bu adres" },
          { id: addrId(order.id, "new"), title: "Yeni adres" },
        ]);
        await log(db, order, "text", body, id);
      } else {
        body = await render(db, order, "CHOOSE_ADDRESS");
        const rows = [
          ...saved.map((a, i) => ({ id: addrId(order.id, a.id), title: `Adres ${i + 1}`, description: a.text })),
          { id: addrId(order.id, "new"), title: "Yeni adres" },
        ];
        const id = await cloud.sendList(phoneId, to, { body, buttonText: "Adres seç", rows });
        await log(db, order, "text", body, id);
      }
      return;
    } catch (err) {
      await reportFailure(db, order, "Kayıtlı adres sorusu (düğme/liste)", body, err);
      // aşağıda düz metinle adres istenir
    }
  }
  const body = await render(db, order, "ASK_ADDRESS");
  try {
    const id = await cloud.sendText(phoneId, to, body);
    await log(db, order, "text", body, id);
  } catch (err) {
    await reportFailure(db, order, "Adres isteme", body, err);
  }
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

const OPEN = { status: "NEW", stage: { in: WAITING_STAGES } };

/** Düğme/liste yanıtı: kimliğindeki siparişe işlenir (müşterinin başka yarım siparişi olsa da karışmaz). */
async function orderById(db: PrismaClient, brandId: number, customerId: number, orderId: number, now: Date): Promise<FullOrder | null> {
  if (!Number.isInteger(orderId)) return null;
  return db.order.findFirst({ where: { id: orderId, brandId, customerId, ...OPEN, createdAt: { gte: new Date(now.getTime() - OPEN_ORDER_WINDOW_MS) } }, include: { brand: true, customer: true } });
}

/** Yazı ve konum: önce ekleme sorusu, adres bekleyen en yeni sipariş, sonra seçenek, ödeme, KVKK bilgilendirmesi bekleyen. */
async function orderForFreeText(db: PrismaClient, brandId: number, customerId: number, now: Date): Promise<FullOrder | null> {
  const where = { brandId, customerId, status: "NEW", createdAt: { gte: new Date(now.getTime() - OPEN_ORDER_WINDOW_MS) } };
  return (
    (await db.order.findFirst({ where: { ...where, stage: "AWAITING_MERGE" }, orderBy: { createdAt: "desc" }, include: { brand: true, customer: true } })) ??
    (await db.order.findFirst({ where: { ...where, stage: "AWAITING_ADDRESS" }, orderBy: { createdAt: "desc" }, include: { brand: true, customer: true } })) ??
    (await db.order.findFirst({ where: { ...where, stage: "AWAITING_OPTIONS" }, orderBy: { createdAt: "desc" }, include: { brand: true, customer: true } })) ??
    (await db.order.findFirst({ where: { ...where, stage: "AWAITING_PAYMENT" }, orderBy: { createdAt: "desc" }, include: { brand: true, customer: true } })) ??
    (await db.order.findFirst({ where: { ...where, stage: "AWAITING_NOTICE" }, orderBy: { createdAt: "desc" }, include: { brand: true, customer: true } }))
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
      if (kind === "merge" && order.stage === "AWAITING_MERGE") return await answerMerge(db, cloud, order, arg === "yes");
      if (kind === "optg" && order.stage === "AWAITING_OPTIONS") {
        const [, , itemId, answer] = reply.split(":");
        await applyGate(db, order.id, Number(itemId), answer === "yes"); // eski düğme yok sayılır, sıradaki soru yeniden sorulur
        return await startOrderConversation(db, cloud, order.id);
      }
      if (kind === "opt" && order.stage === "AWAITING_OPTIONS") {
        const [, , itemId, groupId, choiceId] = reply.split(":");
        await applyAnswer(db, order.id, Number(itemId), Number(groupId), Number(choiceId)); // eski/geçersiz cevap yok sayılır, aşağıda mevcut soru yeniden sorulur
        return await startOrderConversation(db, cloud, order.id);
      }
      if (kind === "kvkk" && order.stage === "AWAITING_NOTICE") {
        if (arg === "ok") return await acknowledgeNotice(db, cloud, order);
        // "KVKK Metni": bağlantıyı ayrıca gönder, ardından düğmeleri yeniden göster
        if (canSend(cloud, order)) {
          const body = `Aydınlatma metnimiz: ${policyUrl() ?? ""}`;
          const id = await cloud.sendText(order.brand.waPhoneNumberId!, order.customer.waId!, body);
          await log(db, order, "text", body, id);
        }
        return await askNotice(db, cloud, order);
      }
      if (kind === "pay" && order.stage === "AWAITING_PAYMENT") return await choosePayment(db, cloud, order, Number(arg));
      if (kind === "addr" && order.stage === "AWAITING_ADDRESS") {
        const chosen = arg === "new" ? null : await db.customerAddress.findFirst({ where: { id: Number(arg), customerId: customer.id } });
        if (chosen) return await finish(db, cloud, order.id, { text: chosen.text, lat: chosen.lat, lng: chosen.lng });
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

    if (order.stage === "AWAITING_NOTICE") {
      // Düğme yerine yazdı: "okudum/tamam" onay sayılır, başka bir şeyse bilgilendirme yeniden gönderilir
      if (message.type === "text" && ACK_TEXT.test((m.text?.body ?? "").trim())) return await acknowledgeNotice(db, cloud, order);
      if (message.type === "text") await askNotice(db, cloud, order);
      return;
    }

    if (order.stage === "AWAITING_MERGE" || order.stage === "AWAITING_PAYMENT" || order.stage === "AWAITING_OPTIONS") {
      // Liste/düğme yerine yazı yazdı: aynı soruyu (ekleme, seçenek ya da ödeme) yeniden gönder
      if (message.type === "text") await startOrderConversation(db, cloud, order.id);
      return;
    }

    if (order.stage === "AWAITING_ADDRESS") {
      if (m.type === "location" && typeof m.location?.latitude === "number" && typeof m.location.longitude === "number") {
        const label = [m.location.name, m.location.address].filter(Boolean).join(", ");
        return await finish(db, cloud, order.id, { text: label || `Konum: ${m.location.latitude.toFixed(5)}, ${m.location.longitude.toFixed(5)}`, lat: m.location.latitude, lng: m.location.longitude });
      }
      if (m.type === "text") {
        const text = (m.text?.body ?? "").trim();
        if (text.length >= ADDRESS_MIN_LENGTH) return await finish(db, cloud, order.id, { text });
        if (canSend(cloud, order)) {
          const body = "Adres çok kısa görünüyor. Lütfen mahalle, sokak ve kapı numarasıyla birlikte yazın ya da konumunuzu gönderin.";
          const id = await cloud.sendText(order.brand.waPhoneNumberId!, order.customer.waId!, body);
          await log(db, order, "text", body, id);
        }
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, messageId: message.id }, "Sipariş akışı yanıtı işlenemedi");
  }
}

async function choosePayment(db: PrismaClient, cloud: WhatsappCloudClient | null, order: FullOrder, paymentTypeId: number): Promise<void> {
  const type = await db.paymentType.findFirst({ where: { id: paymentTypeId, brandId: order.brandId, enabled: true } });
  if (!type) return;
  const { discountKurus, note } = await orderDiscount(db, order.id, type.discountPercent);
  await db.order.update({ where: { id: order.id }, data: { stage: "AWAITING_ADDRESS", paymentTypeId: type.id, paymentLabel: type.name, discountPercent: type.discountPercent, discountKurus, discountNote: note } });
  await askAddress(db, cloud, (await load(db, order.id))!);
}
