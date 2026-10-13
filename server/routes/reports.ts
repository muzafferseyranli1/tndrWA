import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { addDays, buildReport, istanbulDayStart, istanbulParts } from "../../shared/reports";
import { resolveBrand } from "../services/brands";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG biçiminde olmalı.");
const MAX_DAYS = 366;

/** Panel (yalnızca yönetici): satış raporu. Aralık İstanbul gün sınırlarıyla, iki uç dahil. Varsayılan: son 7 gün. */
export function reportsRouter(db: PrismaClient): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const today = istanbulParts(new Date()).date;
    const parsed = z.object({ from: date.default(addDays(today, -6)), to: date.default(today) }).safeParse({ from: req.query.from || undefined, to: req.query.to || undefined });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Geçersiz tarih." });
    const { from, to } = parsed.data;
    if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return res.status(400).json({ error: "Geçersiz tarih." });
    if (from > to) return res.status(400).json({ error: "Başlangıç tarihi bitişten sonra olamaz." });
    if (Date.parse(to) - Date.parse(from) > MAX_DAYS * 86_400_000) return res.status(400).json({ error: `En fazla ${MAX_DAYS} günlük aralık seçilebilir.` });

    const rows = await db.order.findMany({
      where: { brandId: brand.id, createdAt: { gte: istanbulDayStart(from), lt: istanbulDayStart(addDays(to, 1)) } },
      include: { items: true },
      orderBy: { createdAt: "asc" },
    });
    // Yeni müşteri ayrımı: müşterinin bu markadaki ilk siparişinin tarihi
    const ids = [...new Set(rows.map((r) => r.customerId))];
    const firsts = ids.length ? await db.order.groupBy({ by: ["customerId"], where: { brandId: brand.id, customerId: { in: ids } }, _min: { createdAt: true } }) : [];
    const firstSeen = new Map(firsts.map((f) => [f.customerId, f._min.createdAt ? istanbulParts(f._min.createdAt).date : from]));
    res.json({ from, to, brand: { id: brand.id, name: brand.name }, ...buildReport(rows, from, to, firstSeen) });
  });

  return router;
}
