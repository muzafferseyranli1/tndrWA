import type { PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";
import { notifyOrderStatus } from "./order-messages";
import { newRatingToken } from "./ratings";
import type { WhatsappCloudClient } from "./whatsapp-cloud";

/**
 * POS'tan sipariş durumu takibi.
 * - Eklenti siparişi POS'ta oluşturunca: sipariş "Hazırlanıyor" olur, müşteriye anında "alındı" mesajı gider.
 * - Eklenti POS'a girilmiş siparişlerin durumunu düzenli okur: kuryeye verildi → "Yola çıktı" (mesaj),
 *   teslim edildi → "Teslim edildi" (afiyet olsun + değerlendirme), iptal → yalnız panelde iptal (mesaj yok).
 * - Teslim POS'ta görülemezse yola çıktıktan 1 saat sonra teslim sayılır, afiyet olsun + değerlendirme gider.
 */
export const DELIVERY_FALLBACK_MS = 60 * 60 * 1000;
const TRACK_WINDOW_MS = 24 * 60 * 60 * 1000;

export type PosEvent = "ON_THE_WAY" | "DELIVERED" | "CANCELLED";
const RANK: Record<string, number> = { NEW: 0, PREPARING: 1, ON_THE_WAY: 2, DELIVERED: 3, CANCELLED: 3 };

async function loadFull(db: PrismaClient, id: number) {
  return db.order.findUnique({ where: { id }, include: { brand: true, customer: true } });
}

async function setStatus(db: PrismaClient, cloud: WhatsappCloudClient | null, publicBaseUrl: string | null, orderId: number, status: "PREPARING" | PosEvent, why: string, notify: boolean): Promise<boolean> {
  const order = await loadFull(db, orderId);
  if (!order || (RANK[order.status] ?? 0) >= RANK[status] || order.status === "CANCELLED" || order.status === "DELIVERED") return false;
  const updated = await db.order.update({
    where: { id: orderId },
    data: {
      status,
      addedPending: false,
      ...(status === "ON_THE_WAY" ? { onTheWayAt: new Date() } : {}),
      ...(status === "DELIVERED" && !order.ratingToken ? { ratingToken: newRatingToken() } : {}),
    },
    include: { brand: true, customer: true },
  });
  await db.orderChange.create({ data: { orderId, text: why } });
  if (notify) {
    const r = await notifyOrderStatus(db, cloud, updated, status, publicBaseUrl);
    if (!r.sent) logger.warn({ orderId, status, err: r.error }, "POS durum mesajı gönderilemedi");
  }
  return true;
}

/** Eklenti siparişi POS'ta oluşturdu: "Hazırlanıyor" + müşteriye anında "alındı" mesajı. */
export async function markPosEntered(db: PrismaClient, cloud: WhatsappCloudClient | null, publicBaseUrl: string | null, orderId: number): Promise<void> {
  await setStatus(db, cloud, publicBaseUrl, orderId, "PREPARING", "POS'a girildi: müşteriye 'siparişiniz alındı' bildirildi", true);
}

/** Eklentinin izleyeceği siparişler: POS'a girilmiş, bitmemiş, son 24 saat. */
export async function trackingList(db: PrismaClient): Promise<{ id: number; posRef: string; posCafeId: string; posAt: string; status: string }[]> {
  const rows = await db.order.findMany({
    where: { posRef: { not: null }, status: { in: ["NEW", "PREPARING", "ON_THE_WAY"] }, posAt: { gte: new Date(Date.now() - TRACK_WINDOW_MS) }, brand: { posCafeId: { not: null } } },
    include: { brand: { select: { posCafeId: true } } },
    orderBy: { posAt: "asc" },
    take: 100,
  });
  return rows.filter((o) => o.posRef && /\d/.test(o.posRef)).map((o) => ({ id: o.id, posRef: o.posRef!, posCafeId: o.brand.posCafeId!, posAt: (o.posAt ?? o.createdAt).toISOString(), status: o.status }));
}

/** Eklentinin POS'ta gördüğü durum değişiklikleri (yalnız ileri yönde işlenir). */
export async function applyPosEvents(db: PrismaClient, cloud: WhatsappCloudClient | null, publicBaseUrl: string | null, updates: { id: number; event: PosEvent }[]): Promise<number> {
  let n = 0;
  for (const u of updates) {
    const why = u.event === "ON_THE_WAY" ? "POS: kuryeye verildi, müşteriye 'yola çıktı' bildirildi" : u.event === "DELIVERED" ? "POS: teslim edildi, müşteriye afiyet olsun + değerlendirme gönderildi" : "POS'ta iptal edildi";
    if (await setStatus(db, cloud, publicBaseUrl, u.id, u.event, why, u.event !== "CANCELLED")) n++;
  }
  return n;
}

/** Yola çıkalı 1 saati geçen ve POS'ta teslimi görülmeyen siparişler teslim sayılır (afiyet olsun + değerlendirme). */
export async function runDeliveryFallback(db: PrismaClient, cloud: WhatsappCloudClient | null, publicBaseUrl: string | null, now = new Date()): Promise<number> {
  const due = await db.order.findMany({ where: { status: "ON_THE_WAY", posRef: { not: null }, onTheWayAt: { lte: new Date(now.getTime() - DELIVERY_FALLBACK_MS) } }, select: { id: true }, take: 50 });
  let n = 0;
  for (const o of due) if (await setStatus(db, cloud, publicBaseUrl, o.id, "DELIVERED", "Yola çıkalı 1 saat oldu: teslim sayıldı, müşteriye afiyet olsun + değerlendirme gönderildi", true)) n++;
  return n;
}

export function startDeliveryFallback(db: PrismaClient, cloud: WhatsappCloudClient | null, publicBaseUrl: string | null, everyMs = 60_000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runDeliveryFallback(db, cloud, publicBaseUrl)
      .then((n) => n && logger.info({ delivered: n }, "Yola çıkan siparişler teslim sayıldı"))
      .catch((err: Error) => logger.warn({ err: err.message }, "Teslim zamanlayıcısı çalışmadı"))
      .finally(() => {
        running = false;
      });
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
