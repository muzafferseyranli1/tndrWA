import express, { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { CustomerDto, CustomerImportJobDto } from "../../shared/types";
import { logger } from "../lib/logger";
import { emptyStats, importCustomers, readCustomerRows } from "../services/customer-import";

export const MAX_IMPORT_BYTES = 30 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } });
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

interface Job extends CustomerImportJobDto {
  startedAtMs: number;
}

/** Panel: müşteri listesi ve Excel'den toplu müşteri içe aktarma (arka planda çalışır, ilerleme sorgulanır). */
export function customersRouter(db: PrismaClient): Router {
  const router = Router();
  const jobs = new Map<string, Job>();
  let running: string | null = null;

  router.get("/", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const digits = q.replace(/\D/g, "");
    const where = q
      ? { OR: [{ name: { contains: q } }, ...(digits.length >= 3 ? [{ waId: { contains: digits } }] : [])] }
      : {};
    const [total, rows] = await Promise.all([
      db.customer.count({ where }),
      db.customer.findMany({
        where,
        orderBy: { id: "desc" },
        take: limit,
        skip: offset,
        include: { _count: { select: { addresses: true, orders: true } }, addresses: { orderBy: { lastUsedAt: "desc" }, take: 1, select: { text: true } } },
      }),
    ]);
    const items: CustomerDto[] = rows.map((c) => ({ id: c.id, name: c.name, phone: c.waId, addressCount: c._count.addresses, orderCount: c._count.orders, lastAddress: c.addresses[0]?.text ?? null }));
    res.json({ total, items });
  });

  router.post(
    "/import",
    (req: Request, res: Response, next: NextFunction) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (!err) return next();
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `Dosya en fazla ${MAX_IMPORT_BYTES / 1024 / 1024} MB olabilir.` });
        return res.status(400).json({ error: "Dosya yüklenemedi." });
      });
    },
    (req, res) => {
      if (running) return res.status(409).json({ error: "Başka bir içe aktarma sürüyor, bitmesini bekleyin." });
      const file = req.file;
      if (!file) return res.status(400).json({ error: "Excel dosyası gerekli (alan adı: file)." });
      if (file.buffer.length < 4 || !file.buffer.subarray(0, 4).equals(ZIP_MAGIC)) return res.status(400).json({ error: "Yalnızca .xlsx (Excel) dosyası yüklenebilir." });

      const id = randomBytes(6).toString("hex");
      const job: Job = { id, state: "running", fileName: file.originalname.slice(0, 120), stats: emptyStats(), error: null, startedAtMs: Date.now() };
      jobs.set(id, job);
      running = id;
      void importCustomers(db, readCustomerRows(file.buffer), (s) => (job.stats = s))
        .then((stats) => {
          job.stats = stats;
          job.state = "done";
          logger.info({ jobId: id, ...stats }, "Müşteri içe aktarma bitti");
        })
        .catch((err: Error) => {
          job.state = "failed";
          job.error = err.message;
          logger.error({ jobId: id, err: err.message }, "Müşteri içe aktarma başarısız");
        })
        .finally(() => {
          running = null;
          // Eski işleri bellekte biriktirme
          for (const [k, j] of jobs) if (Date.now() - j.startedAtMs > 24 * 60 * 60 * 1000) jobs.delete(k);
        });
      res.status(202).json({ jobId: id });
    },
  );

  router.get("/import/:jobId", (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "İçe aktarma bulunamadı." });
    const { startedAtMs, ...dto } = job;
    void startedAtMs;
    res.json(dto);
  });

  return router;
}
