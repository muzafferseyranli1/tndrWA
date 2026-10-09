import express, { Router } from "express";
import { z } from "zod";
import type { Brand, Customer, Order, OrderChange, OrderItem, OrderItemOption, PrismaClient } from "@prisma/client";
import { formatTRY } from "../../shared/money";
import { describeOptions } from "../services/option-format";
import type { OrderDto } from "../../shared/types";
import { logger } from "../lib/logger";
import { resolveBrand } from "../services/brands";
import { notifyOrderStatus } from "../services/order-messages";
import { EDITABLE_STATUSES, EditError, addItem, editDetails, removeItem, sendUpdateNotice, setQuantity } from "../services/order-edit";
import { ORDER_STATUSES, type OrderStatus } from "../services/orders";
import { priceWithDiscount } from "../services/payment";
import { newRatingToken } from "../services/ratings";
import type { WhatsappCloudClient } from "../services/whatsapp-cloud";

type OrderRow = Order & { items: (OrderItem & { options?: OrderItemOption[] })[]; customer: Customer; changes?: OrderChange[] };

const INCLUDE = { items: { orderBy: { id: "asc" as const }, include: { options: { orderBy: { id: "asc" as const } } } }, customer: true, changes: { orderBy: { createdAt: "desc" as const }, take: 10 } };

export function toOrderDto(o: OrderRow): OrderDto {
  return {
    id: o.id,
    brandId: o.brandId,
    status: o.status as OrderStatus,
    note: o.note,
    totalKurus: o.totalKurus,
    totalText: formatTRY(o.totalKurus),
    stage: o.stage === "AWAITING_PAYMENT" || o.stage === "AWAITING_ADDRESS" ? o.stage : "READY",
    paymentLabel: o.paymentLabel,
    discountPercent: o.discountPercent,
    discountText: o.discountKurus > 0 ? `-${formatTRY(o.discountKurus)}` : "",
    payableText: formatTRY(o.totalKurus - o.discountKurus),
    address: o.address,
    mapUrl: o.lat != null && o.lng != null ? `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}` : o.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}` : null,
    createdAt: o.createdAt.toISOString(),
    paymentTypeId: o.paymentTypeId,
    customerId: o.customerId,
    canEdit: EDITABLE_STATUSES.includes(o.status),
    noticePending: o.noticePending,
    changes: (o.changes ?? []).map((c) => ({ text: c.text, createdAt: c.createdAt.toISOString() })),
    customer: { name: o.customer.name, phone: o.customer.waId },
    items: o.items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, unitText: formatTRY(i.unitKurus + i.extraKurus), lineText: formatTRY((i.unitKurus + i.extraKurus) * i.quantity), options: describeOptions(i.options ?? []) })),
  };
}

const ACTIVE: OrderStatus[] = ["NEW", "PREPARING", "ON_THE_WAY"];

export function ordersRouter(db: PrismaClient, cloud: WhatsappCloudClient | null, publicBaseUrl: string | null = null): Router {
  const router = Router();
  router.use(express.json({ limit: "5kb" }));

  // scope=active: bekleyen ve yoldaki siparişler (eskiden yeniye); scope=history: tamamlanan/iptal son siparişler
  router.get("/", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const history = req.query.scope === "history";
    const rows = await db.order.findMany({
      where: { brandId: brand.id, status: history ? { notIn: ACTIVE } : { in: ACTIVE } },
      include: INCLUDE,
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
    if (existing.stage !== "READY" && status !== "CANCELLED") return res.status(409).json({ error: "Müşteriden ödeme/adres bilgisi bekleniyor. Bilgiler tamamlanınca ya da \"Bilgiler tamam\" ile işleme alabilirsiniz." });

    const updated = await db.order.update({
      where: { id },
      // Teslim edilince müşteriye gidecek değerlendirme bağlantısının anahtarı (bir kez üretilir)
      data: { status, ...(status === "DELIVERED" && !existing.ratingToken ? { ratingToken: newRatingToken() } : {}) },
      include: { ...INCLUDE, brand: true },
    });
    const notice = notify ? await notifyOrderStatus(db, cloud, updated as OrderRow & { brand: Brand }, status, publicBaseUrl) : { sent: false };
    res.json({ order: toOrderDto(updated), notice });
  });

  // Müşteri ödeme/adres adımını tamamlamadıysa personel (telefonla/yazışmayla öğrenip) siparişi elle işleme alır
  router.post("/:id/ready", async (req, res) => {
    const id = Number(req.params.id);
    const parsed = z.object({ address: z.string().trim().max(500).optional(), paymentTypeId: z.number().int().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Geçersiz istek." });
    const existing = Number.isInteger(id) ? await db.order.findUnique({ where: { id } }) : null;
    if (!existing) return res.status(404).json({ error: "Sipariş bulunamadı." });
    if (existing.stage === "READY") return res.status(409).json({ error: "Sipariş zaten işleme hazır." });
    const data: Record<string, unknown> = { stage: "READY" };
    if (parsed.data.address) data.address = parsed.data.address;
    if (parsed.data.paymentTypeId !== undefined) {
      const type = await db.paymentType.findFirst({ where: { id: parsed.data.paymentTypeId, brandId: existing.brandId } });
      if (!type) return res.status(400).json({ error: "Ödeme şekli bulunamadı." });
      const { discountKurus } = priceWithDiscount(existing.totalKurus, type.discountPercent);
      Object.assign(data, { paymentTypeId: type.id, paymentLabel: type.name, discountPercent: type.discountPercent, discountKurus });
    }
    const updated = await db.order.update({ where: { id }, data, include: INCLUDE });
    res.json(toOrderDto(updated));
  });

  // ---- Sipariş düzenleme (Yeni / Hazırlanıyor) ----
  const reload = async (id: number) => toOrderDto(await db.order.findUniqueOrThrow({ where: { id }, include: INCLUDE }));
  const run = (fn: (id: number, req: express.Request) => Promise<unknown>): express.RequestHandler => async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: "Sipariş bulunamadı." });
    try {
      await fn(id, req);
      res.json(await reload(id));
    } catch (err) {
      if (err instanceof EditError) return res.status(err.status).json({ error: err.message });
      logger.error({ err }, "sipariş düzenleme hatası");
      return res.status(500).json({ error: "Beklenmeyen hata, lütfen tekrar deneyin." });
    }
  };

  router.patch(
    "/:id",
    run(async (id, req) => {
      const parsed = z.object({ note: z.string().max(500).optional(), address: z.string().max(500).optional(), addressId: z.number().int().optional(), paymentTypeId: z.number().int().optional() }).safeParse(req.body ?? {});
      if (!parsed.success) throw new EditError("Geçersiz istek.", 400);
      await editDetails(db, id, parsed.data);
    }),
  );

  router.post(
    "/:id/items",
    run(async (id, req) => {
      const parsed = z.object({ productId: z.number().int(), quantity: z.number().int().default(1) }).safeParse(req.body ?? {});
      if (!parsed.success) throw new EditError("productId gerekli.", 400);
      await addItem(db, id, parsed.data.productId, parsed.data.quantity);
    }),
  );

  router.patch(
    "/:id/items/:itemId",
    run(async (id, req) => {
      const parsed = z.object({ quantity: z.number().int() }).safeParse(req.body ?? {});
      if (!parsed.success) throw new EditError("quantity gerekli.", 400);
      await setQuantity(db, id, Number(req.params.itemId), parsed.data.quantity);
    }),
  );

  router.delete(
    "/:id/items/:itemId",
    run(async (id, req) => {
      await removeItem(db, id, Number(req.params.itemId));
    }),
  );

  // Düzenleme bitti: müşteriye güncel özeti gönder
  router.post("/:id/notify-update", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: "Sipariş bulunamadı." });
    try {
      const notice = await sendUpdateNotice(db, cloud, id);
      res.json({ order: await reload(id), notice });
    } catch (err) {
      if (err instanceof EditError) return res.status(err.status).json({ error: err.message });
      logger.error({ err }, "sipariş düzenleme hatası");
      return res.status(500).json({ error: "Beklenmeyen hata, lütfen tekrar deneyin." });
    }
  });

  return router;
}
