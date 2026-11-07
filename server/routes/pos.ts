import express, { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";
import { resolveBrand } from "../services/brands";
import { applyPosGroup, importPosCustomers, newPosToken, PosApplyError, posTokenSet, storeSnapshot, verifyPosToken } from "../services/pos-bridge";
import { latestSnapshot, mapReport, orderPayload, posSnapshotSchema } from "../services/pos-map";

/** POS siparişi sayılan pencere: bundan eski HAZIR sipariş eklentiye verilmez (personel elle girmiştir). */
const ORDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const customersKey = (brandCode: string) => `pos.customers.${brandCode}`;

/**
 * Eklenti uçları (/api/pos-ext): oturum çerezi yok, "X-Pos-Token" başlığındaki anahtarla doğrulanır.
 * POS şubesi (cafeId) bir markaya bağlanır; menü, müşteri ve siparişler o marka için işlenir.
 */
export function posExtRouter(db: PrismaClient): Router {
  const router = Router();
  // Chrome eklentisinden gelen istekler (chrome-extension:// kökeni): CORS izni; doğrulama yine anahtarla
  router.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.get("origin");
    if (origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Pos-Token");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") return void res.status(204).end();
    next();
  });
  router.use(express.json({ limit: "6mb" }));
  router.use(async (req: Request, res: Response, next: NextFunction) => {
    if (!(await verifyPosToken(db, req.get("x-pos-token") ?? undefined))) return void res.status(401).json({ error: "Eklenti anahtarı geçersiz. Panelde POS sayfasından yeni anahtar oluşturup eklentiye girin." });
    next();
  });

  const brandOfCafe = async (cafeId: unknown, res: Response) => {
    const brand = typeof cafeId === "string" && cafeId ? await db.brand.findUnique({ where: { posCafeId: cafeId } }) : null;
    if (!brand) res.status(409).json({ error: "Bu POS şubesi henüz bir markaya bağlı değil. Eklentide markayı seçip menüyü gönderin." });
    return brand;
  };

  router.get("/brands", async (_req, res) => {
    const brands = await db.brand.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, code: true, name: true, posCafeId: true } });
    res.json(brands);
  });

  // POS menüsü: şube bir markaya bağlıysa ona, değilse gönderilen brandId'ye bağlanıp kaydedilir
  router.post("/snapshot", async (req, res) => {
    const parsed = posSnapshotSchema.extend({ brandId: z.number().int().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: `Menü verisi okunamadı: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` });
    const { brandId, ...data } = parsed.data;
    let brand = await db.brand.findUnique({ where: { posCafeId: data.cafeId } });
    if (!brand) {
      if (brandId === undefined) return res.status(409).json({ error: "Bu POS şubesi henüz bir markaya bağlı değil. Eklentide markayı seçin." });
      const target = await db.brand.findUnique({ where: { id: brandId } });
      if (!target) return res.status(404).json({ error: "Marka bulunamadı." });
      if (target.posCafeId && target.posCafeId !== data.cafeId) return res.status(409).json({ error: `${target.name} başka bir POS şubesine bağlı. Panelde POS sayfasından bağlantıyı kaldırın.` });
      brand = await db.brand.update({ where: { id: target.id }, data: { posCafeId: data.cafeId } });
    }
    await storeSnapshot(db, brand.id, data);
    const report = await mapReport(db, brand.id);
    logger.info({ brand: brand.code, products: data.products.length, issues: report.issues.length }, "POS menüsü alındı");
    res.json({ brandId: brand.id, brandName: brand.name, products: data.products.length, ok: report.ok, checked: report.checked, issues: report.issues.length, requiredMissing: report.issues.filter((i) => i.kind === "requiredMissing").length });
  });

  const customersBody = z.object({
    cafeId: z.string().min(1).max(100),
    batch: z.number().int().min(0).default(0),
    of: z.number().int().min(1).default(1),
    customers: z.array(z.object({ name: z.string().max(200).nullable().default(null), phones: z.array(z.string().max(40)).max(5), addresses: z.array(z.string().max(500)).max(30).default([]) })).max(3000),
  });
  router.post("/customers", async (req, res) => {
    const parsed = customersBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Müşteri verisi okunamadı." });
    const brand = await brandOfCafe(parsed.data.cafeId, res);
    if (!brand) return;
    const stats = await importPosCustomers(db, parsed.data.customers);
    // Parça parça gelir: ilk parçada sıfırlanır, sonrakilerde toplanır
    const key = customersKey(brand.code);
    const prev = parsed.data.batch > 0 ? JSON.parse((await db.setting.findUnique({ where: { key } }))?.value ?? "{}") : {};
    const sum = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, (prev[k] ?? 0) + v]));
    await db.setting.upsert({ where: { key }, create: { key, value: JSON.stringify({ ...sum, at: new Date().toISOString(), batch: parsed.data.batch + 1, of: parsed.data.of }) }, update: { value: JSON.stringify({ ...sum, at: new Date().toISOString(), batch: parsed.data.batch + 1, of: parsed.data.of }) } });
    res.json(stats);
  });

  // POS'a yazılmayı bekleyen siparişler: müşteri adımları bitmiş, yola çıkmamış, son 24 saat.
  // Aynı POS şubesinde birden çok işletme (ör. Yerinde Pide, Yerinde Tandır) olabildiği için POS'a bağlı TÜM markaların siparişleri,
  // yazılacakları işletmeyle (POS şube kimliği + adı) birlikte döner; eklenti doğru işletmenin sipariş ekranını açar.
  router.get("/orders", async (_req, res) => {
    const brands = await db.brand.findMany({ where: { posCafeId: { not: null } }, orderBy: { sortOrder: "asc" } });
    const out = [];
    for (const brand of brands) {
      const orders = await db.order.findMany({
        where: { brandId: brand.id, status: { in: ["NEW", "PREPARING"] }, stage: "READY", posRef: null, createdAt: { gte: new Date(Date.now() - ORDER_WINDOW_MS) } },
        orderBy: { createdAt: "asc" },
        take: 30,
        include: { customer: true, items: { orderBy: { id: "asc" }, include: { options: { orderBy: { id: "asc" } } } } },
      });
      const snap = await latestSnapshot(db, brand.id);
      for (const o of orders) out.push({ ...(await orderPayload(db, o, snap?.data ?? null)), brand: { id: brand.id, name: brand.name, posCafeId: brand.posCafeId!, posCafeName: snap?.data.cafeName ?? "" } });
    }
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    res.json({ brands: brands.map((b) => ({ id: b.id, name: b.name, posCafeId: b.posCafeId })), orders: out });
  });

  // Eklenti siparişi POS'ta oluşturdu: POS numarası kaydedilir, bir daha listelenmez
  router.post("/orders/:id/done", async (req, res) => {
    const parsed = z.object({ cafeId: z.string().min(1).max(100), posRef: z.string().trim().min(1).max(40) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Geçersiz istek." });
    const brand = await brandOfCafe(parsed.data.cafeId, res);
    if (!brand) return;
    const id = Number(req.params.id);
    const order = Number.isInteger(id) ? await db.order.findFirst({ where: { id, brandId: brand.id } }) : null;
    if (!order) return res.status(404).json({ error: "Sipariş bulunamadı." });
    await db.order.update({ where: { id }, data: { posRef: parsed.data.posRef, posAt: new Date() } });
    await db.orderChange.create({ data: { orderId: id, text: `POS'a yazıldı: ${parsed.data.posRef}` } });
    res.json({ ok: true });
  });

  return router;
}

/** Panel (yönetici): eklenti anahtarı, şube bağlantısı, eşleşme raporu, eksik zorunlu seçeneği WhatsApp'a ekleme. */
export function posAdminRouter(db: PrismaClient): Router {
  const router = Router();
  router.use(express.json({ limit: "5kb" }));

  router.get("/", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const customers = (await db.setting.findUnique({ where: { key: customersKey(brand.code) } }))?.value;
    res.json({ tokenSet: await posTokenSet(db), posCafeId: brand.posCafeId, customers: customers ? JSON.parse(customers) : null, report: await mapReport(db, brand.id) });
  });

  router.post("/token", async (_req, res) => {
    res.json({ token: await newPosToken(db) });
  });

  router.delete("/link", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    await db.brand.update({ where: { id: brand.id }, data: { posCafeId: null } });
    res.json({ ok: true });
  });

  router.post("/apply-group", async (req, res) => {
    const parsed = z.object({ brandId: z.number().int(), productId: z.number().int(), posGroup: z.string().min(1).max(200) }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Geçersiz istek." });
    try {
      const out = await applyPosGroup(db, parsed.data.brandId, parsed.data.productId, parsed.data.posGroup);
      res.json({ ...out, report: await mapReport(db, parsed.data.brandId) });
    } catch (err) {
      if (err instanceof PosApplyError) return res.status(409).json({ error: err.message });
      throw err;
    }
  });

  return router;
}
