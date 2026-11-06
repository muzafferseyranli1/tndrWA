import express, { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { resolveBrand } from "../services/brands";
import { syncMenu, validateSpec, type MenuSpec } from "../services/menu-sync";

/** Yönetici: kasa menüsünü markaya uygula. Önce dryRun:true ile rapor alınır, sonra dryRun:false ile uygulanır. */
export function menuSyncRouter(db: PrismaClient, onChange: (brandId: number) => void = () => undefined): Router {
  const router = Router();
  router.use(express.json({ limit: "2mb" }));

  router.post("/", async (req, res) => {
    const body = (req.body ?? {}) as { brandId?: unknown; dryRun?: unknown; spec?: MenuSpec };
    const brand = await resolveBrand(db, body.brandId === undefined ? undefined : String(body.brandId));
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    if (!body.spec || !Array.isArray(body.spec.categories) || !Array.isArray(body.spec.optionGroups)) return res.status(400).json({ error: "Menü (spec) gerekli." });
    const invalid = validateSpec(body.spec);
    if (invalid) return res.status(400).json({ error: invalid });
    const dryRun = body.dryRun !== false;
    const report = await syncMenu(db, brand.id, body.spec, dryRun);
    if (!dryRun) onChange(brand.id);
    res.json(report);
  });

  return router;
}
