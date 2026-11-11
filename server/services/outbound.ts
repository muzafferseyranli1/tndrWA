import type { Message, PrismaClient } from "@prisma/client";

export interface OutboundInput {
  brandId: number;
  customerId: number;
  type: "text" | "catalog";
  body: string;
  waMessageId: string | null;
  orderId?: number | null;
  /** whatsapp (varsayılan) | telegram */
  channel?: string;
}

/** Panelden ya da otomatik giden mesajı yazışma geçmişine ekler (teslim durumu sonradan webhook ile güncellenir). */
export function recordOutbound(db: PrismaClient, input: OutboundInput): Promise<Message> {
  return db.message.create({
    data: { brandId: input.brandId, customerId: input.customerId, direction: "OUT", type: input.type, body: input.body, waMessageId: input.waMessageId, status: "SENT", orderId: input.orderId ?? null, channel: input.channel ?? "whatsapp" },
  });
}

/** Gönderilemeyen mesajı yazışmada kırmızı "gitmedi" olarak kaydeder, personel sebebini görür. */
export function recordFailedOutbound(db: PrismaClient, input: OutboundInput, error: string): Promise<Message> {
  return db.message.create({
    data: { brandId: input.brandId, customerId: input.customerId, direction: "OUT", type: input.type, body: input.body, waMessageId: null, status: "FAILED", error: error.slice(0, 400), orderId: input.orderId ?? null, channel: input.channel ?? "whatsapp" },
  });
}
