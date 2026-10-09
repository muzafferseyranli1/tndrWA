import express, { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { TIME_RE, hoursSummary, nextOpeningText, orderingState, type HoursConfig } from "../../shared/hours";
import { resolveBrand } from "../services/brands";
import { getHours, getMinBasket, setHours, setMinBasket } from "../services/hours";

const time = z.string().regex(TIME_RE, "Saat SS:DD biçiminde olmalı (örn. 10:45).");
const day = z.object({ open: time, close: time });

/** Panel: markanın çalışma saatleri. Saat dışında gelen sepetler sipariş olmaz, müşteriye kapalı mesajı gider. */
export function hoursRouter(db: PrismaClient): Router {
  const router = Router();
  router.use(express.json({ limit: "2kb" }));

  const view = (hours: HoursConfig, minBasketKurus: number) => {
    const now = new Date();
    const state = orderingState(hours, now);
    return { hours, state, open: state === "open", nextOpening: nextOpeningText(hours, now), summary: hoursSummary(hours), minBasketKurus };
  };

  router.get("/", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    res.json(view(await getHours(db, brand.code), await getMinBasket(db, brand.code)));
  });

  router.put("/", async (req, res) => {
    const brand = await resolveBrand(db, req.body?.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const parsed = z.object({ enabled: z.boolean(), weekday: day, weekend: day }).safeParse(req.body?.hours);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Geçersiz saatler." });
    const same = (d: { open: string; close: string }) => d.open === d.close;
    if (same(parsed.data.weekday) || same(parsed.data.weekend)) return res.status(400).json({ error: "Açılış ve kapanış saati aynı olamaz." });
    const min = z.number().int().min(0).max(100_000_000).safeParse(req.body?.minBasketKurus ?? 0);
    if (!min.success) return res.status(400).json({ error: "Minimum sepet tutarı geçersiz." });
    await setHours(db, brand.code, parsed.data);
    await setMinBasket(db, brand.code, min.data);
    res.json(view(parsed.data, min.data));
  });

  return router;
}
