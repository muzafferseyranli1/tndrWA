import type { Brand, Customer, Message, PrismaClient } from "@prisma/client";
import { channelHref, normalizePhone } from "../../shared/channels";
import { hoursSummary, nextOpeningText, orderingState } from "../../shared/hours";
import { logger } from "../lib/logger";
import { getHours } from "./hours";
import type { Gateway } from "./messenger";
import { markNoticeSent, noticeLine } from "./notice";
import { handleOrderReply, OPEN_ORDER_WINDOW_MS, WAITING_STAGES } from "./order-flow";
import { recordFailedOutbound, recordOutbound } from "./outbound";
import { repeatOrderIfAsked } from "./repeat-order";
import { TelegramApiError, type ReplyMarkup, type TelegramClient } from "./telegram";

// ---- Telegram güncelleme biçimi (yalnız kullandığımız alanlar) ----
interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
}
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
  contact?: { phone_number: string; user_id?: number };
  location?: { latitude: number; longitude: number };
  reply_markup?: { inline_keyboard?: { text: string; callback_data?: string }[][] };
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; message?: TgMessage; data?: string };
}

export interface TelegramContext {
  db: PrismaClient;
  brand: Brand;
  client: TelegramClient;
  /** Sohbet akışının (ödeme, adres, durum) mesaj gönderdiği geçit; yoksa yalnız karşılama çalışır */
  gateway: Gateway | null;
  /** Mini App adresi için herkese açık HTTPS adres */
  publicBaseUrl: string | null;
}

const fullName = (u: TgUser) => [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || null;

/** Telegram kullanıcısının müşteri kaydını bulur, yoksa oluşturur (adı yalnız boşsa yazılır). */
export async function upsertTelegramCustomer(db: PrismaClient, user: TgUser): Promise<Customer> {
  const tgId = String(user.id);
  const existing = await db.customer.findUnique({ where: { tgId } });
  if (existing) return existing.name || !fullName(user) ? existing : db.customer.update({ where: { id: existing.id }, data: { name: fullName(user) } });
  return db.customer.create({ data: { tgId, name: fullName(user) } });
}

/**
 * Müşterinin telefonunu Telegram kaydına bağlar. Aynı numaralı WhatsApp müşterisi varsa iki kayıt TEK müşteride birleşir:
 * WhatsApp kaydı kalır (geçmişi, adresleri, siparişleri), Telegram kaydının mesaj/sipariş/adres/değerlendirmeleri ona taşınır.
 * Döndürülen, birleşme sonrası geçerli müşteri kaydıdır.
 */
export async function linkPhone(db: PrismaClient, customer: Customer, phone: string): Promise<Customer> {
  if (customer.waId === phone) return customer;
  const other = await db.customer.findUnique({ where: { waId: phone } });
  if (!other) return db.customer.update({ where: { id: customer.id }, data: { waId: phone } });
  if (other.id === customer.id) return customer;
  return db.$transaction(async (tx) => {
    await tx.message.updateMany({ where: { customerId: customer.id }, data: { customerId: other.id } });
    await tx.order.updateMany({ where: { customerId: customer.id }, data: { customerId: other.id } });
    await tx.rating.updateMany({ where: { customerId: customer.id }, data: { customerId: other.id } });
    const have = new Set((await tx.customerAddress.findMany({ where: { customerId: other.id }, select: { key: true } })).map((a) => a.key));
    for (const a of await tx.customerAddress.findMany({ where: { customerId: customer.id } })) {
      if (have.has(a.key)) await tx.customerAddress.delete({ where: { id: a.id } });
      else await tx.customerAddress.update({ where: { id: a.id }, data: { customerId: other.id } });
    }
    // tgId benzersiz: önce Telegram kaydından alınır, sonra WhatsApp kaydına yazılır, en son Telegram kaydı silinir
    await tx.customer.update({ where: { id: customer.id }, data: { tgId: null } });
    const merged = await tx.customer.update({
      where: { id: other.id },
      data: { tgId: customer.tgId, name: other.name ?? customer.name, noticeSentAt: other.noticeSentAt ?? customer.noticeSentAt, noticeAckAt: other.noticeAckAt ?? customer.noticeAckAt },
    });
    await tx.customer.delete({ where: { id: customer.id } });
    return merged;
  });
}

/** Mini App (menü ve sepet) adresi; herkese açık HTTPS adres yoksa Telegram düğmeyi kabul etmez, null döner. */
export function miniAppUrl(publicBaseUrl: string | null, brandCode: string): string | null {
  return publicBaseUrl?.startsWith("https://") ? `${publicBaseUrl}/tg/${brandCode}` : null;
}

function menuMarkup(ctx: TelegramContext): ReplyMarkup | undefined {
  const url = miniAppUrl(ctx.publicBaseUrl, ctx.brand.code);
  return url ? { inline_keyboard: [[{ text: "🍽 Menüyü aç", web_app: { url } }]] } : undefined;
}

/** Giden mesajı gönderir ve yazışmaya kaydeder (gönderilemezse kırmızı "gitmedi" + sebep). */
export async function say(ctx: TelegramContext, customer: Customer, text: string, markup?: ReplyMarkup): Promise<void> {
  const chatId = customer.tgId!;
  const base = { brandId: ctx.brand.id, customerId: customer.id, type: "text" as const, body: text, channel: "telegram", waMessageId: null as string | null };
  try {
    const messageId = await ctx.client.sendMessage(chatId, text, markup);
    await recordOutbound(ctx.db, { ...base, waMessageId: `tg:${ctx.brand.code}:${chatId}:${messageId}` });
  } catch (err) {
    logger.warn({ brand: ctx.brand.code, err: (err as Error).message }, "Telegram mesajı gönderilemedi");
    await recordFailedOutbound(ctx.db, base, (err as Error).message).catch(() => undefined);
  }
}

export const SHARE_PHONE: ReplyMarkup = { keyboard: [[{ text: "📱 Numaramı paylaş", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };

async function whatsappLine(db: PrismaClient, brand: Brand): Promise<string> {
  const ch = await db.brandChannel.findFirst({ where: { brandId: brand.id, kind: "WHATSAPP", enabled: true } });
  const href = ch?.value ? channelHref("WHATSAPP", ch.value, "Merhaba, sipariş vermek istiyorum.") : null;
  return href ? `WhatsApp'tan da sipariş verebilirsiniz: ${href}` : "";
}

/** Karşılama: marka adı, (kapalıysa) çalışma saatleri, ilk temasta KVKK bilgilendirmesi ve "Menüyü aç" düğmesi. */
async function welcome(ctx: TelegramContext, customer: Customer): Promise<void> {
  const hours = await getHours(ctx.db, ctx.brand.code);
  const closed = orderingState(hours, new Date()) === "closed";
  const kvkk = await noticeLine(ctx.db, customer);
  const markup = menuMarkup(ctx);
  const lines = [
    `Merhaba${customer.name ? " " + customer.name : ""}! 👋 ${ctx.brand.name} sipariş botuna hoş geldiniz.`,
    closed ? `Şu an kapalıyız (${hoursSummary(hours)}). Bir sonraki açılış: ${nextOpeningText(hours, new Date())}.` : "",
    markup ? "Menüyü açıp sepetinizi hazırlayabilirsiniz." : "Menü şu an açılamıyor; WhatsApp'tan sipariş verebilirsiniz.",
    markup ? "" : await whatsappLine(ctx.db, ctx.brand),
    kvkk,
  ].filter(Boolean);
  await say(ctx, customer, lines.join("\n\n"), markup);
  if (kvkk) await markNoticeSent(ctx.db, customer.id);
}

/** Gelen mesajı yazışmaya kaydeder; Telegram aynı güncellemeyi yeniden gönderdiyse null döner. */
async function recordIn(ctx: TelegramContext, customer: Customer, waMessageId: string, type: string, body: string): Promise<Message | null> {
  if (await ctx.db.message.findUnique({ where: { waMessageId } })) return null;
  try {
    return await ctx.db.message.create({ data: { brandId: ctx.brand.id, customerId: customer.id, direction: "IN", type, body, waMessageId, status: "RECEIVED", channel: "telegram" } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return null; // eşzamanlı yeniden gönderim
    throw err;
  }
}

/** Müşterinin bu markada, Telegram'da yanıt beklenen açık siparişi var mı (ödeme, adres, seçenek, KVKK onayı)? */
async function hasOpenOrder(ctx: TelegramContext, customer: Customer): Promise<boolean> {
  const open = await ctx.db.order.findFirst({
    where: { brandId: ctx.brand.id, customerId: customer.id, channel: "telegram", status: "NEW", stage: { in: WAITING_STAGES }, createdAt: { gte: new Date(Date.now() - OPEN_ORDER_WINDOW_MS) } },
    select: { id: true },
  });
  return !!open;
}

/** Bir Telegram güncellemesini işler. Hata fırlatmaz (Telegram yeniden denemesin diye); sorunlar günlüğe yazılır. */
export async function handleTelegramUpdate(ctx: TelegramContext, update: TgUpdate): Promise<void> {
  try {
    // Düğme yanıtı: sohbet akışının kimliği (ör. "pay:12:3") WhatsApp liste yanıtı gibi akışa verilir
    const cb = update.callback_query;
    if (cb) {
      await ctx.client.answerCallbackQuery(cb.id).catch(() => undefined);
      const chat = cb.message?.chat;
      if (!cb.data || cb.from.is_bot || !chat || chat.type !== "private" || !ctx.gateway) return;
      const customer = await upsertTelegramCustomer(ctx.db, cb.from);
      // Eski mesajın düğmeleri kalksın (iki kez dokunulmasın)
      if (cb.message) void ctx.client.editMessageReplyMarkup(chat.id, cb.message.message_id).catch(() => undefined);
      const title = cb.message?.reply_markup?.inline_keyboard?.flat().find((b) => b.callback_data === cb.data)?.text;
      const message = await recordIn(ctx, customer, `tg:${ctx.brand.code}:${chat.id}:cb:${cb.id}`, "interactive", title ?? cb.data);
      if (!message) return;
      await handleOrderReply(ctx.db, ctx.gateway, ctx.brand, customer, message, { type: "interactive", interactive: { list_reply: { id: cb.data } } });
      return;
    }

    const msg = update.message;
    if (!msg?.from || msg.from.is_bot || msg.chat.type !== "private") return; // yalnız kullanıcıyla özel sohbet

    let customer = await upsertTelegramCustomer(ctx.db, msg.from);
    const type = msg.contact ? "contact" : msg.location ? "location" : msg.text ? "text" : "other";
    const body = msg.text ?? (msg.contact ? "Telefon numarası paylaşıldı" : msg.location ? `Konum: ${msg.location.latitude.toFixed(5)}, ${msg.location.longitude.toFixed(5)}` : "[desteklenmeyen mesaj]");
    const message = await recordIn(ctx, customer, `tg:${ctx.brand.code}:${msg.chat.id}:${msg.message_id}`, type, body);
    if (!message) return; // aynı güncelleme yeniden geldi

    if (msg.contact) {
      // Yalnızca kendi numarasını paylaşan kabul edilir (başkasının kişisini iletmek numarayı çalamaz)
      const phone = msg.contact.user_id === msg.from.id ? normalizePhone(msg.contact.phone_number) : null;
      if (!phone) {
        await say(ctx, customer, "Lütfen aşağıdaki düğmeyle kendi numaranızı paylaşın.", SHARE_PHONE);
        return;
      }
      customer = await linkPhone(ctx.db, customer, phone);
      const markup = menuMarkup(ctx);
      await say(ctx, customer, "Teşekkürler, numaranız kaydedildi ✅" + (markup ? "\n\nMenüyü açıp sipariş verebilirsiniz." : ""), markup ?? { remove_keyboard: true });
      return;
    }

    const command = msg.text?.trim().split(/[\s@]/)[0].toLowerCase();
    if (command === "/start" || command === "/menu") return await welcome(ctx, customer);

    // Konum ya da yazı: bekleyen siparişin adresi/yanıtı olabilir; "1" son siparişi tekrarlar
    if ((msg.text || msg.location) && ctx.gateway) {
      if (await repeatOrderIfAsked(ctx.db, ctx.gateway, ctx.brand, customer, message)) return;
      if (await hasOpenOrder(ctx, customer)) {
        const raw = msg.location ? { type: "location", location: { latitude: msg.location.latitude, longitude: msg.location.longitude } } : { type: "text", text: { body: msg.text } };
        await handleOrderReply(ctx.db, ctx.gateway, ctx.brand, customer, message, raw);
        return;
      }
    }
    await say(ctx, customer, "Sipariş vermek için menüyü açın.", menuMarkup(ctx));
  } catch (err) {
    if (err instanceof TelegramApiError) logger.warn({ brand: ctx.brand.code, err: err.message }, "Telegram güncellemesi işlenemedi");
    else logger.error({ brand: ctx.brand.code, err }, "Telegram güncellemesi işlenemedi");
  }
}

/**
 * Açılışta her bot için webhook, komutlar, açıklama ve menü düğmesini Telegram'a yazar (yalnız TELEGRAM_SET_WEBHOOK=1 iken, yani canlıda).
 * Jetonun gerçekten o markanın botuna ait olduğu kullanıcı adından doğrulanır; uyuşmazsa HİÇBİR ŞEY yazılmaz (jetonlar yer değiştirmiş olabilir).
 */
export async function configureTelegramBots(db: PrismaClient, clients: Record<string, TelegramClient>, publicBaseUrl: string): Promise<void> {
  for (const [code, client] of Object.entries(clients)) {
    try {
      const brand = await db.brand.findUnique({ where: { code } });
      if (!brand) {
        logger.warn({ code }, "Telegram: bu kodlu marka yok, bot yapılandırılmadı");
        continue;
      }
      const me = await client.getMe();
      if (!me.username.toLowerCase().includes(code)) {
        logger.warn({ code, bot: me.username }, "Telegram: jeton bu markanın botuna benzemiyor, bot yapılandırılmadı");
        continue;
      }
      const url = `${publicBaseUrl}/api/webhooks/telegram/${code}`;
      const info = await client.getWebhookInfo();
      if (info.url !== url) await client.setWebhook(url);
      await client.setMyCommands([
        { command: "start", description: "Başla" },
        { command: "menu", description: "Menü ve sipariş" },
      ]);
      await client.setMyShortDescription(`${brand.name}: menüyü açın, sipariş verin.`);
      await client.setMyDescription(`${brand.name} sipariş botu. Menüyü görmek, sipariş vermek ve siparişinizin durumunu öğrenmek için Başla'ya dokunun.`);
      // Sohbet kutusunun yanındaki "Menü" düğmesi doğrudan Mini App'i açar
      const app = miniAppUrl(publicBaseUrl, code);
      if (app) await client.setChatMenuButton({ type: "web_app", text: "Menü", web_app: { url: app } });
      logger.info({ code, bot: me.username, url }, "Telegram botu yapılandırıldı");
    } catch (err) {
      logger.warn({ code, err: (err as Error).message }, "Telegram botu yapılandırılamadı");
    }
  }
}
