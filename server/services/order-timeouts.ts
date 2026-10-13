import type { PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";
import { resendPendingQuestion } from "./order-flow";
import { orderVars, renderTemplate, templateFor } from "./order-messages";
import { recordFailedOutbound, recordOutbound } from "./outbound";
import type { WhatsappCloudClient } from "./whatsapp-cloud";

/** Müşteri soruya bu süre yanıt vermezse soru tekrarlanır; hatırlatmadan sonra yine bu süre yanıt yoksa sipariş iptal edilir. */
export const REPLY_TIMEOUT_MS = Number(process.env.ORDER_REPLY_TIMEOUT_MS) || 5 * 60 * 1000;
const WAITING_STAGES = ["AWAITING_OPTIONS", "AWAITING_PAYMENT", "AWAITING_ADDRESS"];

export type TimeoutAction = "remind" | "cancel" | null;

/** Yanıt bekleyen sipariş için yapılacak iş. Soru hiç gönderilmemişse (promptedAt yok) dokunulmaz. */
export function timeoutAction(order: { status: string; stage: string; promptedAt: Date | null; reminderSentAt: Date | null }, now: Date): TimeoutAction {
  if (order.status !== "NEW" || !WAITING_STAGES.includes(order.stage) || !order.promptedAt) return null;
  if (order.reminderSentAt) return now.getTime() - order.reminderSentAt.getTime() >= REPLY_TIMEOUT_MS ? "cancel" : null;
  return now.getTime() - order.promptedAt.getTime() >= REPLY_TIMEOUT_MS ? "remind" : null;
}

/** Bir tur: süresi dolan siparişlerde soruyu tekrarlar + hatırlatma gönderir ya da siparişi iptal edip müşteriye bildirir. Hata fırlatmaz. */
export async function runOrderTimeouts(db: PrismaClient, cloud: WhatsappCloudClient | null, now = new Date()): Promise<{ reminded: number; cancelled: number }> {
  const result = { reminded: 0, cancelled: 0 };
  if (!cloud) return result;
  const waiting = await db.order.findMany({ where: { status: "NEW", stage: { in: WAITING_STAGES }, promptedAt: { not: null } }, include: { brand: true, customer: true } });
  for (const order of waiting) {
    const action = timeoutAction(order, now);
    if (!action) continue;
    try {
      const send = async (key: "ORDER_REMINDER" | "ORDER_TIMEOUT") => {
        const body = renderTemplate(await templateFor(db, order.brand.code, key), orderVars(order, order.customer));
        if (!order.brand.waPhoneNumberId || !order.customer.waId) return;
        try {
          const id = await cloud.sendText(order.brand.waPhoneNumberId, order.customer.waId, body);
          await recordOutbound(db, { brandId: order.brandId, customerId: order.customerId, type: "text", body, waMessageId: id, orderId: order.id });
        } catch (err) {
          await recordFailedOutbound(db, { brandId: order.brandId, customerId: order.customerId, type: "text", body, waMessageId: null, orderId: order.id }, (err as Error).message);
        }
      };
      if (action === "remind") {
        await resendPendingQuestion(db, cloud, order.id);
        await send("ORDER_REMINDER");
        await db.order.update({ where: { id: order.id }, data: { reminderSentAt: new Date() } });
        result.reminded++;
      } else {
        // Bu arada müşteri yanıt verip sipariş ilerlediyse iptal etme
        const fresh = await db.order.findUnique({ where: { id: order.id } });
        if (!fresh || timeoutAction(fresh, now) !== "cancel") continue;
        await db.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
        await db.orderChange.create({ data: { orderId: order.id, text: "Müşteriden yanıt gelmediği için sipariş otomatik iptal edildi." } });
        await send("ORDER_TIMEOUT");
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
export function startOrderTimeouts(db: PrismaClient, cloud: WhatsappCloudClient | null, everyMs = 20_000): () => void {
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
