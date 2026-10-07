import express, { Router } from "express";
import { z } from "zod";
import type { Customer, Message, PrismaClient } from "@prisma/client";
import type { ChatConversationDto, ChatMessageDto, ChatThreadDto } from "../../shared/types";
import { logger } from "../lib/logger";
import { resolveBrand } from "../services/brands";
import { SESSION_WINDOW_MS, sendFailureText } from "../services/chat";
import { recordOutbound } from "../services/outbound";
import { CloudApiError, type WhatsappCloudClient } from "../services/whatsapp-cloud";

const MAX_TEXT = 1000;
const CATALOG_TEXT = "Menümüzü görmek için aşağıdaki düğmeye dokunabilirsiniz.";

const toMessageDto = (m: Message): ChatMessageDto => ({
  id: m.id,
  direction: m.direction === "IN" ? "IN" : "OUT",
  type: m.type,
  body: m.body,
  status: m.status,
  error: m.error,
  orderId: m.orderId,
  createdAt: m.createdAt.toISOString(),
});

/** Müşterinin son mesajından itibaren 24 saat: serbest metin yalnızca bu pencerede gönderilebilir. */
async function windowOf(db: PrismaClient, brandId: number, customerId: number, now = new Date()): Promise<{ open: boolean; endsAt: string | null }> {
  const lastIn = await db.message.findFirst({ where: { brandId, customerId, direction: "IN" }, orderBy: { createdAt: "desc" } });
  if (!lastIn) return { open: false, endsAt: null };
  const end = new Date(lastIn.createdAt.getTime() + SESSION_WINDOW_MS);
  return { open: end.getTime() > now.getTime(), endsAt: end.toISOString() };
}

export function chatRouter(db: PrismaClient, cloud: WhatsappCloudClient | null): Router {
  const router = Router();
  router.use(express.json({ limit: "5kb" }));

  // Konuşma listesi: son mesaja göre yeniden eskiye, okunmamış sayısıyla
  router.get("/conversations", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const groups = await db.message.groupBy({ by: ["customerId"], where: { brandId: brand.id }, _max: { createdAt: true }, orderBy: { _max: { createdAt: "desc" } }, take: 100 });
    const customers = await db.customer.findMany({ where: { id: { in: groups.map((g) => g.customerId) } } });
    const byId = new Map<number, Customer>(customers.map((c) => [c.id, c]));
    const now = new Date();

    const out: ChatConversationDto[] = [];
    for (const g of groups) {
      const c = byId.get(g.customerId);
      if (!c) continue;
      const last = await db.message.findFirst({ where: { brandId: brand.id, customerId: c.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      if (!last) continue;
      const unread = await db.message.count({ where: { brandId: brand.id, customerId: c.id, direction: "IN", ...(c.readAt ? { createdAt: { gt: c.readAt } } : {}) } });
      const win = await windowOf(db, brand.id, c.id, now);
      out.push({
        customerId: c.id,
        name: c.name,
        phone: c.waId,
        lastBody: last.body,
        lastType: last.type,
        lastDirection: last.direction === "IN" ? "IN" : "OUT",
        lastAt: last.createdAt.toISOString(),
        unread,
        windowOpen: win.open,
      });
    }
    res.json(out);
  });

  router.get("/unread", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const customers = await db.customer.findMany({ where: { messages: { some: { brandId: brand.id, direction: "IN" } } } });
    let count = 0;
    for (const c of customers) count += await db.message.count({ where: { brandId: brand.id, customerId: c.id, direction: "IN", ...(c.readAt ? { createdAt: { gt: c.readAt } } : {}) } });
    res.json({ count });
  });

  router.get("/:customerId", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const customerId = Number(req.params.customerId);
    const customer = Number.isInteger(customerId) ? await db.customer.findUnique({ where: { id: customerId } }) : null;
    if (!customer) return res.status(404).json({ error: "Müşteri bulunamadı." });

    const recent = await db.message.findMany({ where: { brandId: brand.id, customerId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200 });
    if (req.query.read === "1") await db.customer.update({ where: { id: customerId }, data: { readAt: new Date() } });
    const win = await windowOf(db, brand.id, customerId);
    const dto: ChatThreadDto = {
      customer: { id: customer.id, name: customer.name, phone: customer.waId },
      messages: recent.reverse().map(toMessageDto),
      windowOpen: win.open,
      windowEndsAt: win.endsAt,
    };
    res.json(dto);
  });

  async function send(req: express.Request, res: express.Response, kind: "text" | "catalog") {
    const parsed = z
      .object({ brandId: z.number().int().optional(), text: z.string().trim().min(1, "Mesaj boş olamaz.").max(MAX_TEXT, `Mesaj en fazla ${MAX_TEXT} karakter olabilir.`).optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Geçersiz istek." });
    if (kind === "text" && !parsed.data.text) return res.status(400).json({ error: "Mesaj boş olamaz." });
    const brand = await resolveBrand(db, parsed.data.brandId === undefined ? undefined : String(parsed.data.brandId));
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const customerId = Number(req.params.customerId);
    const customer = Number.isInteger(customerId) ? await db.customer.findUnique({ where: { id: customerId } }) : null;
    if (!customer) return res.status(404).json({ error: "Müşteri bulunamadı." });

    if (!cloud) return res.status(503).json({ error: "WhatsApp gönderim jetonu (WHATSAPP_CLOUD_TOKEN) tanımlı değil." });
    if (!brand.waPhoneNumberId) return res.status(503).json({ error: `${brand.name} için Cloud API telefon numarası kimliği girilmemiş (Markalar sayfası).` });
    if (!customer.waId) return res.status(409).json({ error: "Bu müşterinin telefon numarası yok (yalnızca Meta kullanıcı kimliği var), mesaj gönderilemez." });
    const win = await windowOf(db, brand.id, customerId);
    if (!win.open) return res.status(409).json({ error: sendFailureText("re-engagement") });

    try {
      const text = kind === "catalog" ? parsed.data.text ?? CATALOG_TEXT : parsed.data.text!;
      const id = kind === "catalog" ? await cloud.sendCatalog(brand.waPhoneNumberId, customer.waId, text) : await cloud.sendText(brand.waPhoneNumberId, customer.waId, text);
      const saved = await recordOutbound(db, { brandId: brand.id, customerId, type: kind, body: text, waMessageId: id });
      res.json(toMessageDto(saved));
    } catch (err) {
      const e = err as CloudApiError;
      logger.warn({ code: e.code, err: e.message }, "panelden mesaj gönderilemedi");
      res.status(err instanceof CloudApiError ? 502 : 500).json({ error: sendFailureText(e.message, e.code) });
    }
  }

  router.post("/:customerId/send", (req, res) => void send(req, res, "text"));
  router.post("/:customerId/catalog", (req, res) => void send(req, res, "catalog"));

  return router;
}
