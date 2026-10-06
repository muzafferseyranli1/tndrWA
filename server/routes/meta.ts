import express, { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { MetaStatusDto } from "../../shared/types";
import type { SyncCoordinator } from "../services/meta-sync";

export function metaRouter(db: PrismaClient, coordinator: SyncCoordinator): Router {
  const router = Router();
  router.use(express.json({ limit: "10kb" }));

  router.get("/status", async (_req, res) => {
    const grouped = await db.product.groupBy({ by: ["metaSyncState"], _count: true });
    const count = (state: string) => grouped.find((g) => g.metaSyncState === state)?._count ?? 0;
    const status: MetaStatusDto = {
      configured: coordinator.blockers().length === 0,
      publicBaseUrl: coordinator.publicUrl(),
      autoSync: coordinator.isAutoSync(),
      counts: { pending: count("PENDING"), synced: count("SYNCED"), error: count("ERROR") },
      blockers: coordinator.blockers(),
    };
    res.json(status);
  });

  router.post("/sync", async (req, res) => {
    const parsed = z.object({ ids: z.array(z.number().int()).max(500).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Geçersiz istek." });

    const blockers = coordinator.blockers();
    if (blockers.length) return res.status(503).json({ error: `Eşitleme yapılamıyor: ${blockers.join("; ")}.` });

    try {
      res.json(await coordinator.run({ ids: parsed.data.ids }));
    } catch (err) {
      const message = (err as Error).message;
      res.status(message.includes("zaten sürüyor") ? 409 : 502).json({ error: message });
    }
  });

  return router;
}
