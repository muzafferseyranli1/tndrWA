import express, { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { isChannelKind } from "../../shared/channels";
import { normalizePhone } from "../../shared/channels";
import type { RatingContextDto, RatingResultDto } from "../../shared/types";
import { publicBrand } from "../services/channels";
import { isLow, reviewLinks, reviewMinScore } from "../services/ratings";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;

/** Giriş gerektirmeyen uçlar (açılış sayfası): marka listesi, marka kanalları, sayaç. Kişisel veri saklanmaz. */
export function publicRouter(db: PrismaClient): Router {
  const router = Router();
  router.use(express.json({ limit: "4kb" }));

  // Sayaç kötüye kullanımına karşı IP başına dakikalık sınır (bellekte tutulur, kalıcı yazılmaz)
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const allowed = (ip: string, now = Date.now()) => {
    const b = buckets.get(ip);
    if (!b || b.resetAt <= now) {
      buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
      if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      return true;
    }
    b.count++;
    return b.count <= MAX_PER_WINDOW;
  };

  router.get("/brands", async (_req, res) => {
    const brands = await db.brand.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, name: true } });
    res.set("Cache-Control", "public, max-age=60").json(brands);
  });

  router.get("/brands/:code", async (req, res) => {
    const brand = await publicBrand(db, req.params.code);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    res.set("Cache-Control", "public, max-age=30").json(brand);
  });

  router.post("/hit", async (req, res) => {
    if (!allowed(req.ip ?? "?")) return res.status(429).end();
    const parsed = z.object({ brand: z.string().max(40).optional(), event: z.enum(["landing", "brand", "click"]), kind: z.string().max(20).optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).end();
    const { brand, event, kind } = parsed.data;
    if (event === "click" && !isChannelKind(kind)) return res.status(400).end();
    const b = brand ? await db.brand.findUnique({ where: { code: brand }, select: { id: true } }) : null;
    if (brand && !b) return res.status(404).end();
    await db.hit.create({ data: { brandId: b?.id ?? null, event, kind: event === "click" ? kind : null } });
    res.status(204).end();
  });

  // ---- Değerlendirme (QR'dan anonim ya da teslim mesajındaki sipariş bağlantısıyla) ----
  const ratingBuckets = new Map<string, { count: number; resetAt: number }>();
  const ratingAllowed = (ip: string, now = Date.now()) => {
    const b = ratingBuckets.get(ip);
    if (!b || b.resetAt <= now) {
      ratingBuckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
      return true;
    }
    b.count++;
    return b.count <= 10;
  };

  router.get("/rating", async (req, res) => {
    const code = typeof req.query.brand === "string" ? req.query.brand : "";
    const token = typeof req.query.t === "string" && req.query.t ? req.query.t : null;
    const brand = await db.brand.findUnique({ where: { code } });
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    let order = null;
    if (token) {
      order = await db.order.findUnique({ where: { ratingToken: token }, include: { ratingRef: true } });
      if (!order || order.brandId !== brand.id) return res.status(404).json({ error: "Bu değerlendirme bağlantısı geçersiz." });
    }
    const dto: RatingContextDto = { brandName: brand.name, alreadyRated: order ? !!order.ratingRef : false, orderNo: order?.id ?? null };
    res.set("Cache-Control", "no-store").json(dto);
  });

  const score = z.number().int().min(1, "Puan 1-5 arasında olmalı.").max(5, "Puan 1-5 arasında olmalı.");
  router.post("/ratings", async (req, res) => {
    if (!ratingAllowed(req.ip ?? "?")) return res.status(429).json({ error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." });
    const parsed = z
      .object({
        brand: z.string().max(40),
        t: z.string().max(40).optional(),
        taste: score,
        care: score,
        delivery: score,
        comment: z.string().trim().max(1000, "Yorum en fazla 1000 karakter olabilir.").optional(),
        name: z.string().trim().max(60).optional(),
        phone: z.string().trim().max(25).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Geçersiz istek." });
    const d = parsed.data;
    const brand = await db.brand.findUnique({ where: { code: d.brand } });
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });

    let order = null;
    if (d.t) {
      order = await db.order.findUnique({ where: { ratingToken: d.t }, include: { customer: true, ratingRef: true } });
      if (!order || order.brandId !== brand.id) return res.status(404).json({ error: "Bu değerlendirme bağlantısı geçersiz." });
      if (order.ratingRef) return res.status(409).json({ error: "Bu sipariş için değerlendirmenizi zaten aldık, teşekkür ederiz.", alreadyRated: true });
    }
    let phone: string | null = null;
    if (d.phone) {
      phone = normalizePhone(d.phone);
      if (!phone) return res.status(400).json({ error: "Telefon numarası geçersiz görünüyor." });
    }
    const low = isLow(d.taste, d.care, d.delivery);
    try {
      await db.rating.create({
        data: {
          brandId: brand.id,
          orderId: order?.id ?? null,
          customerId: order?.customerId ?? null,
          taste: d.taste,
          care: d.care,
          delivery: d.delivery,
          comment: d.comment ?? "",
          name: d.name || order?.customer.name || null,
          phone: phone ?? order?.customer.waId ?? null,
          low,
          followUp: low ? "PENDING" : "NONE",
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") return res.status(409).json({ error: "Bu sipariş için değerlendirmenizi zaten aldık, teşekkür ederiz.", alreadyRated: true });
      throw err;
    }
    const result: RatingResultDto = { ok: true, low, links: await reviewLinks(db, brand.id, await reviewMinScore(db), Math.min(d.taste, d.care, d.delivery)) };
    res.json(result);
  });

  return router;
}
