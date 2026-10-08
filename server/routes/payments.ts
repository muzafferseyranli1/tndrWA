import express, { Router } from "express";
import { z } from "zod";
import type { PaymentType, PrismaClient } from "@prisma/client";
import type { PaymentTypeDto } from "../../shared/types";
import { resolveBrand } from "../services/brands";
import { moveInOrder } from "./products";

/** WhatsApp seçim listesi en fazla 10 satır alır. */
export const MAX_ENABLED_PAYMENT_TYPES = 10;

const toDto = (p: PaymentType): PaymentTypeDto => ({ id: p.id, name: p.name, discountPercent: p.discountPercent, enabled: p.enabled });

const body = z.object({
  name: z.string().trim().min(1, "Ad gerekli.").max(24, "Ad en fazla 24 karakter olabilir (WhatsApp listesi sınırı)."),
  discountPercent: z.number().int().min(0, "İndirim 0'dan küçük olamaz.").max(90, "İndirim en fazla %90 olabilir."),
  enabled: z.boolean(),
});

/** Panel: marka başına ödeme şekilleri ve her birinin indirim oranı. */
export function paymentsRouter(db: PrismaClient): Router {
  const router = Router();
  router.use(express.json({ limit: "2kb" }));

  router.get("/", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const rows = await db.paymentType.findMany({ where: { brandId: brand.id }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
    res.json(rows.map(toDto));
  });

  router.post("/", async (req, res) => {
    const parsed = body.extend({ brandId: z.number().int().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Geçersiz istek." });
    const brand = await resolveBrand(db, parsed.data.brandId === undefined ? undefined : String(parsed.data.brandId));
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    if (await db.paymentType.findUnique({ where: { brandId_name: { brandId: brand.id, name: parsed.data.name } } })) return res.status(409).json({ error: "Bu isimde bir ödeme şekli zaten var." });
    if (parsed.data.enabled && (await db.paymentType.count({ where: { brandId: brand.id, enabled: true } })) >= MAX_ENABLED_PAYMENT_TYPES) {
      return res.status(409).json({ error: `En fazla ${MAX_ENABLED_PAYMENT_TYPES} ödeme şekli açık olabilir (WhatsApp listesi sınırı).` });
    }
    const last = await db.paymentType.findFirst({ where: { brandId: brand.id }, orderBy: { sortOrder: "desc" } });
    const created = await db.paymentType.create({ data: { brandId: brand.id, name: parsed.data.name, discountPercent: parsed.data.discountPercent, enabled: parsed.data.enabled, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    res.status(201).json(toDto(created));
  });

  router.put("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const parsed = body.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Geçersiz istek." });
    const existing = Number.isInteger(id) ? await db.paymentType.findUnique({ where: { id } }) : null;
    if (!existing) return res.status(404).json({ error: "Ödeme şekli bulunamadı." });
    const clash = await db.paymentType.findFirst({ where: { brandId: existing.brandId, name: parsed.data.name, NOT: { id } } });
    if (clash) return res.status(409).json({ error: "Bu isimde bir ödeme şekli zaten var." });
    if (parsed.data.enabled && !existing.enabled && (await db.paymentType.count({ where: { brandId: existing.brandId, enabled: true } })) >= MAX_ENABLED_PAYMENT_TYPES) {
      return res.status(409).json({ error: `En fazla ${MAX_ENABLED_PAYMENT_TYPES} ödeme şekli açık olabilir (WhatsApp listesi sınırı).` });
    }
    const updated = await db.paymentType.update({ where: { id }, data: parsed.data });
    res.json(toDto(updated));
  });

  router.post("/:id/move", async (req, res) => {
    const id = Number(req.params.id);
    const parsed = z.object({ direction: z.enum(["up", "down"]) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "direction (up/down) gerekli." });
    const existing = Number.isInteger(id) ? await db.paymentType.findUnique({ where: { id } }) : null;
    if (!existing) return res.status(404).json({ error: "Ödeme şekli bulunamadı." });
    const rows = await db.paymentType.findMany({ where: { brandId: existing.brandId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true } });
    const moves = moveInOrder(rows, id, parsed.data.direction);
    if (moves) await db.$transaction(moves.map((m) => db.paymentType.update({ where: { id: m.id }, data: { sortOrder: m.position } })));
    res.json({ moved: moves !== null });
  });

  return router;
}
