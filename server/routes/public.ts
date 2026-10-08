import express, { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { isChannelKind } from "../../shared/channels";
import { publicBrand } from "../services/channels";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;

/** Giriş gerektirmeyen uçlar (açılış sayfası): marka listesi, marka kanalları, sayaç. Kişisel veri saklanmaz. */
export function publicRouter(db: PrismaClient): Router {
  const router = Router();
  router.use(express.json({ limit: "1kb" }));

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

  return router;
}
