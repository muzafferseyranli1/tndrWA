import express, { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { CustomerDto, CustomerImportJobDto, CustomerRobotStatusDto } from "../../shared/types";
import { logger } from "../lib/logger";
import { emptyStats, importCustomers, readCustomerRows } from "../services/customer-import";

export const MAX_IMPORT_BYTES = 30 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } });
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
export const ROBOT_STATUS_KEY = "customers.robot";

interface Job extends CustomerImportJobDto {
  startedAtMs: number;
}

export interface ImportRunner {
  start(file: { buffer: Buffer; name: string }, source: "panel" | "robot"): { jobId: string } | { error: string; status: number };
  get(jobId: string): CustomerImportJobDto | null;
}

/** Excel içe aktarma işleri: aynı anda tek iş; ilerleme sorgulanır. Robot işleri sonucu ayarlara yazılır (panelde görünür). */
export function createImportRunner(db: PrismaClient): ImportRunner {
  const jobs = new Map<string, Job>();
  let running: string | null = null;

  const record = (ok: boolean, message: string) =>
    db.setting
      .upsert({ where: { key: ROBOT_STATUS_KEY }, create: { key: ROBOT_STATUS_KEY, value: JSON.stringify({ at: new Date().toISOString(), ok, message }) }, update: { value: JSON.stringify({ at: new Date().toISOString(), ok, message }) } })
      .catch((err: Error) => logger.warn({ err: err.message }, "Robot durumu kaydedilemedi"));

  return {
    start(file, source) {
      if (running) return { error: "Başka bir içe aktarma sürüyor, bitmesini bekleyin.", status: 409 };
      if (file.buffer.length < 4 || !file.buffer.subarray(0, 4).equals(ZIP_MAGIC)) return { error: "Yalnızca .xlsx (Excel) dosyası yüklenebilir.", status: 400 };
      const id = randomBytes(6).toString("hex");
      const job: Job = { id, state: "running", fileName: file.name.slice(0, 120), stats: emptyStats(), error: null, startedAtMs: Date.now() };
      jobs.set(id, job);
      running = id;
      void importCustomers(db, readCustomerRows(file.buffer), (s) => (job.stats = s))
        .then(async (stats) => {
          job.stats = stats;
          job.state = "done";
          logger.info({ jobId: id, source, ...stats }, "Müşteri içe aktarma bitti");
          if (source === "robot") await record(true, `${stats.read} satır okundu, ${stats.created} yeni müşteri, ${stats.addressesAdded} yeni adres`);
        })
        .catch(async (err: Error) => {
          job.state = "failed";
          job.error = err.message;
          logger.error({ jobId: id, source, err: err.message }, "Müşteri içe aktarma başarısız");
          if (source === "robot") await record(false, `İçe aktarma başarısız: ${err.message}`);
        })
        .finally(() => {
          running = null;
          // Eski işleri bellekte biriktirme
          for (const [k, j] of jobs) if (Date.now() - j.startedAtMs > 24 * 60 * 60 * 1000) jobs.delete(k);
        });
      return { jobId: id };
    },
    get(jobId) {
      const job = jobs.get(jobId);
      if (!job) return null;
      const { startedAtMs, ...dto } = job;
      void startedAtMs;
      return dto;
    },
  };
}

function uploadOne(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `Dosya en fazla ${MAX_IMPORT_BYTES / 1024 / 1024} MB olabilir.` });
    return res.status(400).json({ error: "Dosya yüklenemedi." });
  });
}

/** Panel: müşteri listesi ve Excel'den toplu müşteri içe aktarma (arka planda çalışır, ilerleme sorgulanır). */
export function customersRouter(db: PrismaClient, runner: ImportRunner = createImportRunner(db)): Router {
  const router = Router();

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

  // Otomatik (robot) aktarımın son durumu: panelde uyarı göstermek için
  router.get("/robot-status", async (_req, res) => {
    const row = await db.setting.findUnique({ where: { key: ROBOT_STATUS_KEY } });
    let last: { at: string; ok: boolean; message: string } | null = null;
    try {
      if (row) last = JSON.parse(row.value);
    } catch {
      last = null;
    }
    const dto: CustomerRobotStatusDto = { configured: Boolean(process.env.IMPORT_TOKEN?.trim()), last };
    res.json(dto);
  });

  // Müşterinin kayıtlı adresleri (sipariş düzenlerken seçmek için), en son kullanılan başta
  router.get("/:id/addresses", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: "Müşteri bulunamadı." });
    const rows = await db.customerAddress.findMany({ where: { customerId: id }, orderBy: [{ lastUsedAt: "desc" }, { id: "desc" }], take: 20 });
    res.json(rows.map((a) => ({ id: a.id, text: a.text, hasLocation: a.lat !== null && a.lng !== null })));
  });

  router.post("/import", uploadOne, (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Excel dosyası gerekli (alan adı: file)." });
    const out = runner.start({ buffer: file.buffer, name: file.originalname }, "panel");
    if ("error" in out) return res.status(out.status).json({ error: out.error });
    res.status(202).json({ jobId: out.jobId });
  });

  router.get("/import/:jobId", (req, res) => {
    const job = runner.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "İçe aktarma bulunamadı." });
    res.json(job);
  });

  return router;
}

function tokenOk(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * VPS'teki robot (RMS'ten müşteri Excel'ini indirip gönderen): oturum çerezi yok, X-Robot-Token başlığıyla doğrulanır.
 * IMPORT_TOKEN tanımlı değilse uçlar kapalıdır (503). Auth'tan ÖNCE bağlanmalı.
 */
export function robotRouter(db: PrismaClient, runner: ImportRunner, token: string | undefined): Router {
  const router = Router();
  const expected = token?.trim() ?? "";
  router.use((req, res, next) => {
    if (!expected) return res.status(503).json({ error: "Robot erişimi kapalı (IMPORT_TOKEN tanımlı değil)." });
    if (!tokenOk(req.headers["x-robot-token"], expected)) return res.status(401).json({ error: "Geçersiz robot anahtarı." });
    next();
  });

  router.post("/customers", uploadOne, (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Excel dosyası gerekli (alan adı: file)." });
    const out = runner.start({ buffer: file.buffer, name: file.originalname }, "robot");
    if ("error" in out) return res.status(out.status).json({ error: out.error });
    res.status(202).json({ jobId: out.jobId });
  });

  router.get("/customers/:jobId", (req, res) => {
    const job = runner.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "İçe aktarma bulunamadı." });
    res.json(job);
  });

  // Robot kendi hatasını bildirir (giriş yapılamadı, indirme gelmedi...): panelde uyarı olarak görünür
  router.post("/report", express.json({ limit: "5kb" }), async (req, res) => {
    const ok = req.body?.ok === true;
    const message = typeof req.body?.message === "string" ? req.body.message.slice(0, 300) : "";
    const value = JSON.stringify({ at: new Date().toISOString(), ok, message });
    await db.setting.upsert({ where: { key: ROBOT_STATUS_KEY }, create: { key: ROBOT_STATUS_KEY, value }, update: { value } });
    res.json({ ok: true });
  });

  return router;
}
