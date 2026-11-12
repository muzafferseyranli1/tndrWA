import type { PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";
import { WAITING_STAGES, resendPendingQuestion } from "./order-flow";
import { sendMenu } from "./menu-message";
import { findMergeTarget } from "./order-merge";
import { orderVars, renderTemplate, templateFor } from "./order-messages";
import { recordFailedOutbound, recordOutbound } from "./outbound";
import { addrOf, type Messenger } from "./messenger";

/** Müşteri soruya bu süre yanıt vermezse soru tekrarlanır; hatırlatmadan sonra yine bu süre yanıt yoksa sipariş iptal edilir. */
export const REPLY_TIMEOUT_MS = Number(process.env.ORDER_REPLY_TIMEOUT_MS) || 5 * 60 * 1000;

export type TimeoutAction = "remind" | "cancel" | null;

/** Yanıt bekleyen sipariş için yapılacak iş. Soru hiç gönderilmemişse (promptedAt yok) dokunulmaz. */
export function timeoutAction(order: { status: string; stage: string; promptedAt: Date | null; reminderSentAt: Date | null }, now: Date): TimeoutAction {
  if (order.status !== "NEW" || !WAITING_STAGES.includes(order.stage) || !order.promptedAt) return null;
  if (order.reminderSentAt) return now.getTime() - order.reminderSentAt.getTime() >= REPLY_TIMEOUT_MS ? "cancel" : null;
  return now.getTime() - order.promptedAt.getTime() >= REPLY_TIMEOUT_MS ? "remind" : null;
}

/** Bir tur: süresi dolan siparişlerde soruyu tekrarlar + hatırlatma gönderir ya da siparişi iptal edip müşteriye bildirir. Hata fırlatmaz. */
export async function runOrderTimeouts(db: PrismaClient, cloud: Messenger | null, now = new Date()): Promise<{ reminded: number; cancelled: number }> {
  const result = { reminded: 0, cancelled: 0 };
  if (!cloud) return result;
  const waiting = await db.order.findMany({ where: { status: "NEW", stage: { in: WAITING_STAGES }, promptedAt: { not: null } }, include: { brand: true, customer: true } });
  for (const order of waiting) {
    const action = timeoutAction(order, now);
    if (!action) continue;
    try {
      // Ek sepet (açık siparişe ekleme sorusu ya da "ekle" dedikten sonraki seçenekler): müşteri yalnız açık siparişin numarasını gördü;
      // mesajlar o numarayla ve "ürünler eklenmedi, siparişiniz devam ediyor" diye gider, asıl sipariş iptal edilmiş sanılmasın
      const addingTo = async () => {
        const o = await db.order.findUnique({ where: { id: order.id } });
        if (!o || o.status !== "NEW") return null;
        if (o.mergeIntoId) return o.mergeIntoId;
        return o.stage === "AWAITING_MERGE" ? ((await findMergeTarget(db, o.brandId, o.customerId, o.id, now, o.channel))?.id ?? null) : null;
      };
      const send = async (key: "ORDER_REMINDER" | "ORDER_TIMEOUT", target: number | null) => {
        const tpl = target ? (key === "ORDER_REMINDER" ? "MERGE_REMINDER" : "MERGE_TIMEOUT") : key;
        const body = renderTemplate(await templateFor(db, order.brand.code, tpl), { ...orderVars(order, order.customer), ...(target ? { no: target } : {}) });
        const a = addrOf(order.brand, order.customer, order.channel);
        if (!cloud || !a || !(cloud.can?.(a[0]) ?? true)) return;
        // Sipariş sonlandı: müşteri yeniden sepet kurabilsin diye mesaj menüyle (liste ya da katalog düğmesi) birlikte gider (yalnız WhatsApp; Telegram'da menü Mini App'tir)
        if (key === "ORDER_TIMEOUT" && order.channel === "whatsapp") {
          try {
            const id = await sendMenu(db, cloud, order.brand, order.customer.waId!, body);
            await recordOutbound(db, { brandId: order.brandId, customerId: order.customerId, type: "catalog", body, waMessageId: id, orderId: order.id, channel: order.channel });
            return;
          } catch (err) {
            logger.warn({ err: (err as Error).message, orderId: order.id }, "Sonlandırma mesajı menüyle gönderilemedi, düz metin deneniyor");
          }
        }
        try {
          const id = await cloud.sendText(...a, body);
          await recordOutbound(db, { brandId: order.brandId, customerId: order.customerId, type: "text", body, waMessageId: id, orderId: order.id, channel: order.channel });
        } catch (err) {
          await recordFailedOutbound(db, { brandId: order.brandId, customerId: order.customerId, type: "text", body, waMessageId: null, orderId: order.id, channel: order.channel }, (err as Error).message);
        }
      };
      if (action === "remind") {
        await resendPendingQuestion(db, cloud, order.id);
        await send("ORDER_REMINDER", await addingTo()); // soru yeniden sorulurken açık sipariş yola çıktıysa ek sepet normal siparişe dönmüştür
        await db.order.update({ where: { id: order.id }, data: { reminderSentAt: new Date() } });
        result.reminded++;
      } else {
        // Bu arada müşteri yanıt verip sipariş ilerlediyse iptal etme
        const fresh = await db.order.findUnique({ where: { id: order.id } });
        if (!fresh || timeoutAction(fresh, now) !== "cancel") continue;
        const target = await addingTo();
        await db.order.update({ where: { id: order.id }, data: { status: "CANCELLED", mergeIntoId: null } });
        await db.orderChange.create({ data: { orderId: order.id, text: target ? `Müşteriden yanıt gelmediği için ek sepet otomatik iptal edildi (Sipariş #${target} aynen devam ediyor).` : "Müşteriden yanıt gelmediği için sipariş otomatik iptal edildi." } });
        await send("ORDER_TIMEOUT", target);
        result.cancelled++;
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message, orderId: order.id, action }, "Yanıt bekleyen sipariş işlenemedi");
    }
  }
  if (result.reminded || result.cancelled) logger.info(result, "Yanıt bekleyen siparişler işlendi");
  return result;
}

/** Arka planda düzenli çalıştırır (aynı anda tek tur). */
export function startOrderTimeouts(db: PrismaClient, cloud: Messenger | null, everyMs = 20_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runOrderTimeouts(db, cloud)
      .catch((err: Error) => logger.warn({ err: err.message }, "Yanıt zamanlayıcısı çalışmadı"))
      .finally(() => {
        running = false;
      });
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
