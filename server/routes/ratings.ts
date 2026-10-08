import express, { Router } from "express";
import { z } from "zod";
import type { PrismaClient, Rating } from "@prisma/client";
import type { RatingDto, RatingSummaryDto } from "../../shared/types";
import { resolveBrand } from "../services/brands";
import { DEFAULT_REVIEW_MIN_SCORE, reviewMinScore, setReviewMinScore } from "../services/ratings";

const FOLLOW_UP = ["PENDING", "CALLED", "RESOLVED"] as const;

const toDto = (r: Rating): RatingDto => ({
  id: r.id,
  orderId: r.orderId,
  taste: r.taste,
  care: r.care,
  delivery: r.delivery,
  comment: r.comment,
  name: r.name,
  phone: r.phone,
  low: r.low,
  followUp: (["NONE", "PENDING", "CALLED", "RESOLVED"].includes(r.followUp) ? r.followUp : "NONE") as RatingDto["followUp"],
  followNote: r.followNote,
  createdAt: r.createdAt.toISOString(),
});

const avg = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** Panel: değerlendirmeler, düşük puan arama listesi ve dış bağlantı ayarı. */
export function ratingsRouter(db: PrismaClient): Router {
  const router = Router();
  router.use(express.json({ limit: "2kb" }));

  // filter=pending: aranacaklar | low: tüm düşük puanlılar | all
  router.get("/", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const filter = req.query.filter === "all" ? "all" : req.query.filter === "low" ? "low" : "pending";
    const where = { brandId: brand.id, ...(filter === "pending" ? { followUp: "PENDING" } : filter === "low" ? { low: true } : {}) };
    const rows = await db.rating.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    res.json(rows.map(toDto));
  });

  router.get("/summary", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const where = { brandId: brand.id, createdAt: { gte: since } };
    const [agg, lowCount, pendingCount] = await Promise.all([
      db.rating.aggregate({ where, _count: { _all: true }, _avg: { taste: true, care: true, delivery: true } }),
      db.rating.count({ where: { ...where, low: true } }),
      db.rating.count({ where: { brandId: brand.id, followUp: "PENDING" } }),
    ]);
    const dto: RatingSummaryDto = { days, count: agg._count._all, lowCount, pendingCount, avgTaste: avg(agg._avg.taste), avgCare: avg(agg._avg.care), avgDelivery: avg(agg._avg.delivery) };
    res.json(dto);
  });

  router.patch("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const parsed = z.object({ followUp: z.enum(FOLLOW_UP), followNote: z.string().trim().max(500, "Not en fazla 500 karakter olabilir.").optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Geçersiz istek." });
    const existing = Number.isInteger(id) ? await db.rating.findUnique({ where: { id } }) : null;
    if (!existing) return res.status(404).json({ error: "Değerlendirme bulunamadı." });
    const updated = await db.rating.update({ where: { id }, data: { followUp: parsed.data.followUp, ...(parsed.data.followNote !== undefined ? { followNote: parsed.data.followNote } : {}) } });
    res.json(toDto(updated));
  });

  // Dış değerlendirme bağlantıları (Google, platformlar) kimlere gösterilsin: en düşük puan bu değerden küçük olanlara gösterilmez
  router.get("/settings/links", async (_req, res) => res.json({ minScore: await reviewMinScore(db), defaultMinScore: DEFAULT_REVIEW_MIN_SCORE }));

  router.put("/settings/links", async (req, res) => {
    const parsed = z.object({ minScore: z.number().int().min(1).max(5) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "minScore 1-5 arasında olmalı." });
    await setReviewMinScore(db, parsed.data.minScore);
    res.json({ minScore: parsed.data.minScore });
  });

  return router;
}
