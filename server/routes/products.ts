import express, { Router, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_RESET_HOUR, nextResetAt } from "../../shared/availability";
import { parsePriceToKurus } from "../../shared/money";
import { slugify } from "../../shared/slug";
import { toProductDto } from "../services/product-dto";

const priceSchema = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const kurus = parsePriceToKurus(v);
    if (kurus === null || kurus <= 0) {
      ctx.addIssue({ code: "custom", message: "Geçerli bir fiyat girin (örn. 949 veya 1.099,00)." });
      return z.NEVER;
    }
    return kurus;
  });

const createSchema = z.object({
  name: z.string().trim().min(1, "Ürün adı gerekli.").max(150, "Ürün adı en fazla 150 karakter."),
  description: z.string().trim().max(1000, "Açıklama en fazla 1000 karakter.").default(""),
  price: priceSchema,
  categoryId: z.number().int(),
  status: z.enum(["ACTIVE", "PASSIVE"]).default("ACTIVE"),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    description: z.string().trim().max(1000),
    price: priceSchema,
    categoryId: z.number().int(),
    status: z.enum(["ACTIVE", "PASSIVE"]),
    sortOrder: z.number().int(),
  })
  .partial();

function fail(res: Response, status: number, error: string) {
  res.status(status).json({ error });
}

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Geçersiz istek.";
}

async function uniqueRetailerId(db: PrismaClient, name: string): Promise<string> {
  const base = slugify(name) || "urun";
  let candidate = base;
  for (let n = 2; await db.product.findUnique({ where: { retailerId: candidate } }); n++) {
    candidate = `${base}-${n}`;
  }
  return candidate;
}

async function resetHour(db: PrismaClient): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: "dayResetHour" } });
  const hour = Number(row?.value);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_RESET_HOUR;
}

export function productsRouter(db: PrismaClient, onChange: () => void = () => undefined): Router {
  const router = Router();
  router.use(express.json({ limit: "20kb" }));

  router.get("/", async (_req, res) => {
    const products = await db.product.findMany({
      include: { category: true },
      orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { id: "asc" }],
    });
    res.json(products.map((p) => toProductDto(p)));
  });

  router.get("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const product = Number.isInteger(id) ? await db.product.findUnique({ where: { id }, include: { category: true } }) : null;
    if (!product) return fail(res, 404, "Ürün bulunamadı.");
    res.json(toProductDto(product));
  });

  router.post("/", async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, firstIssue(parsed.error));
    const { name, description, price, categoryId, status } = parsed.data;

    if (!(await db.category.findUnique({ where: { id: categoryId } }))) return fail(res, 400, "Kategori bulunamadı.");

    const last = await db.product.findFirst({ where: { categoryId }, orderBy: { sortOrder: "desc" } });
    const created = await db.product.create({
      data: {
        retailerId: await uniqueRetailerId(db, name),
        name,
        description,
        priceKurus: price,
        categoryId,
        status,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
      include: { category: true },
    });
    onChange();
    res.status(201).json(toProductDto(created));
  });

  router.patch("/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !(await db.product.findUnique({ where: { id } }))) return fail(res, 404, "Ürün bulunamadı.");

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, firstIssue(parsed.error));
    const { price, categoryId, ...rest } = parsed.data;

    if (categoryId !== undefined && !(await db.category.findUnique({ where: { id: categoryId } }))) {
      return fail(res, 400, "Kategori bulunamadı.");
    }

    // Pasife alınan ürünün "bugün tükendi" işareti anlamsızlaşır
    const clearSoldOut = rest.status === "PASSIVE" ? { soldOutUntil: null } : {};
    const updated = await db.product.update({
      where: { id },
      data: {
        ...rest,
        ...clearSoldOut,
        ...(price !== undefined ? { priceKurus: price } : {}),
        ...(categoryId !== undefined ? { categoryId } : {}),
        metaSyncState: "PENDING", // değişiklik Meta'ya henüz gönderilmedi
      },
      include: { category: true },
    });
    onChange();
    res.json(toProductDto(updated));
  });

  // "Bugün tükendi" aç/kapat. Açıkken ertesi sabah (varsayılan 05:00, Türkiye saati) otomatik biter.
  router.post("/:id/sold-out", async (req, res) => {
    const id = Number(req.params.id);
    const parsed = z.object({ soldOut: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "soldOut (true/false) gerekli.");
    const product = Number.isInteger(id) ? await db.product.findUnique({ where: { id } }) : null;
    if (!product) return fail(res, 404, "Ürün bulunamadı.");
    if (product.status === "PASSIVE") return fail(res, 400, "Pasif ürün zaten katalogda görünmez.");

    const updated = await db.product.update({
      where: { id },
      data: {
        soldOutUntil: parsed.data.soldOut ? nextResetAt(new Date(), await resetHour(db)) : null,
        metaSyncState: "PENDING",
      },
      include: { category: true },
    });
    onChange();
    res.json(toProductDto(updated));
  });

  return router;
}

export function categoriesRouter(db: PrismaClient): Router {
  const router = Router();
  router.use(express.json({ limit: "5kb" }));

  router.get("/", async (_req, res) => {
    const categories = await db.category.findMany({ orderBy: { sortOrder: "asc" } });
    res.json(categories.map((c) => ({ id: c.id, name: c.name })));
  });

  router.post("/", async (req, res) => {
    const parsed = z.object({ name: z.string().trim().min(1, "Kategori adı gerekli.").max(80) }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, firstIssue(parsed.error));
    if (await db.category.findUnique({ where: { name: parsed.data.name } })) return fail(res, 409, "Bu kategori zaten var.");
    const last = await db.category.findFirst({ orderBy: { sortOrder: "desc" } });
    const created = await db.category.create({ data: { name: parsed.data.name, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    res.status(201).json({ id: created.id, name: created.name });
  });

  return router;
}
