import type { Message, PrismaClient } from "@prisma/client";

export interface OutboundInput {
  brandId: number;
  customerId: number;
  type: "text" | "catalog";
  body: string;
  waMessageId: string | null;
  orderId?: number | null;
}

/** Panelden ya da otomatik giden mesajı yazışma geçmişine ekler (teslim durumu sonradan webhook ile güncellenir). */
export function recordOutbound(db: PrismaClient, input: OutboundInput): Promise<Message> {
  return db.message.create({
    data: { brandId: input.brandId, customerId: input.customerId, direction: "OUT", type: input.type, body: input.body, waMessageId: input.waMessageId, status: "SENT", orderId: input.orderId ?? null },
  });
}
