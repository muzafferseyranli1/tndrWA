import { Router } from "express";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { BackupDto } from "../../shared/types";
import { logger } from "../lib/logger";
import { KEEP_DAYS, type BackupService } from "../services/backup";

/** Panel: yedek listesi, elle yedek alma ve indirme. */
export function backupsRouter(service: BackupService): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const dto: BackupDto = { dir: service.backupDir, keepDays: KEEP_DAYS, files: await service.list(), ...service.status() };
    res.json(dto);
  });

  router.post("/run", async (_req, res) => {
    if (service.status().running) return res.status(409).json({ error: "Bir yedekleme zaten sürüyor." });
    try {
      const files = await service.run();
      res.json({ files });
    } catch (err) {
      logger.error({ err }, "elle yedekleme başarısız");
      res.status(500).json({ error: `Yedek alınamadı: ${(err as Error).message}` });
    }
  });

  router.get("/download", async (req, res) => {
    const file = typeof req.query.name === "string" ? service.pathFor(req.query.name) : null;
    if (!file) return res.status(400).json({ error: "Geçersiz yedek adı." });
    const st = await stat(file).catch(() => null);
    if (!st) return res.status(404).json({ error: "Yedek bulunamadı." });
    res.set({ "Content-Type": "application/gzip", "Content-Length": String(st.size), "Content-Disposition": `attachment; filename="${req.query.name}"` });
    createReadStream(file).pipe(res);
  });

  return router;
}
