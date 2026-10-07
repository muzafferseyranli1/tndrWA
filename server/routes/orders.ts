import express, { Router } from "express";
import { z } from "zod";
import type { Brand, Customer, Order, OrderItem, PrismaClient } from "@prisma/client";
import { formatTRY } from "../../shared/money";
import type { OrderDto } from "../../shared/types";
import { resolveBrand } from "../services/brands";
import { notifyOrderStatus } from "../services/order-messages";
import { ORDER_STATUSES, type OrderStatus } from "../services/orders";
import type { WhatsappCloudClient } from "../services/whatsapp-cloud";

type OrderRow = Order & { items: OrderItem[]; customer: Customer };

export function toOrderDto(o: OrderRow): OrderDto {
  return {
    id: o.id,
    brandId: o.brandId,
    status: o.status as OrderStatus,
    note: o.note,
    totalKurus: o.totalKurus,
    totalText: formatTRY(o.totalKurus),
    createdAt: o.createdAt.toISOString(),
    customer: { name: o.customer.name, phone: o.customer.waId },
    items: o.items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, unitText: formatTRY(i.unitKurus), lineText: formatTRY(i.unitKurus * i.quantity) })),
  };
}

const ACTIVE: OrderStatus[] = ["NEW", "PREPARING", "ON_THE_WAY"];

export function ordersRouter(db: PrismaClient, cloud: WhatsappCloudClient | null): Router {
  const router = Router();
  router.use(express.json({ limit: "5kb" }));

  // scope=active: bekleyen ve yoldaki siparişler (eskiden yeniye); scope=history: tamamlanan/iptal son siparişler
  router.get("/", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const history = req.query.scope === "history";
    const rows = await db.order.findMany({
      where: { brandId: brand.id, status: history ? { notIn: ACTIVE } : { in: ACTIVE } },
      include: { items: { orderBy: { id: "asc" } }, customer: true },
      orderBy: { createdAt: history ? "desc" : "asc" },
      take: history ? 100 : 200,
    });
    res.json(rows.map(toOrderDto));
  });

  router.post("/:id/status", async (req, res) => {
    const id = Number(req.params.id);
    const parsed = z.object({ status: z.enum(ORDER_STATUSES), notify: z.boolean().default(true) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Geçerli bir durum (status) gerekli." });
    const existing = Number.isInteger(id) ? await db.order.findUnique({ where: { id } }) : null;
    if (!existing) return res.status(404).json({ error: "Sipariş bulunamadı." });
    const { status, notify } = parsed.data;
    if (existing.status === status) return res.status(409).json({ error: "Sipariş zaten bu durumda." });

    const updated = await db.order.update({
      where: { id },
      data: { status },
      include: { items: { orderBy: { id: "asc" } }, customer: true, brand: true },
    });
    const notice = notify ? await notifyOrderStatus(db, cloud, updated as OrderRow & { brand: Brand }, status) : { sent: false };
    res.json({ order: toOrderDto(updated), notice });
  });

  return router;
}
