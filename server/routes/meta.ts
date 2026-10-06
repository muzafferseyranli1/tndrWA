import express, { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { MetaStatusDto } from "../../shared/types";
import { resolveBrand } from "../services/brands";
import type { SyncCoordinator } from "../services/meta-sync";

export function metaRouter(db: PrismaClient, coordinator: SyncCoordinator): Router {
  const router = Router();
  router.use(express.json({ limit: "10kb" }));

  router.get("/status", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const grouped = await db.product.groupBy({ by: ["metaSyncState"], where: { brandId: brand.id }, _count: true });
    const count = (state: string) => grouped.find((g) => g.metaSyncState === state)?._count ?? 0;
    const blockers = coordinator.blockers(brand);
    const status: MetaStatusDto = {
      configured: blockers.length === 0,
      publicBaseUrl: coordinator.publicUrl(),
      autoSync: coordinator.isAutoSync(),
      counts: { pending: count("PENDING"), synced: count("SYNCED"), error: count("ERROR") },
      blockers,
    };
    res.json(status);
  });

  router.post("/sync", async (req, res) => {
    const parsed = z.object({ brandId: z.number().int().optional(), ids: z.array(z.number().int()).max(1000).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Geçersiz istek." });

    const brand = await resolveBrand(db, parsed.data.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const blockers = coordinator.blockers(brand);
    if (blockers.length) return res.status(503).json({ error: `Eşitleme yapılamıyor: ${blockers.join("; ")}.` });

    try {
      res.json(await coordinator.run(brand.id, { ids: parsed.data.ids }));
    } catch (err) {
      const message = (err as Error).message;
      res.status(message.includes("zaten sürüyor") ? 409 : 502).json({ error: message });
    }
  });

  return router;
}
