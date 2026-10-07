import express, { Router, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { DEFAULT_RESET_HOUR, nextResetAt } from "../../shared/availability";
import { parsePriceToKurus, portionPrice } from "../../shared/money";
import { slugify } from "../../shared/slug";
import { resolveBrand } from "../services/brands";
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

const label = z.string().trim().min(1, "Porsiyon adı gerekli.").max(40, "Porsiyon adı en fazla 40 karakter.");

const createSchema = z.object({
  brandId: z.number().int(),
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
    variantLabel: label,
  })
  .partial();

const variantSchema = z
  .object({
    label,
    /** Açık fiyat; verilmezse "factor" ile hesaplanır */
    price: priceSchema.optional(),
    /** Çarpan (örn. 1.5): fiyat = ürün fiyatı x çarpan, tam liraya yuvarlanır */
    factor: z.number().min(1.01).max(10).optional(),
    /** Ürün henüz porsiyonsuzsa, mevcut kaydın alacağı ad (örn. "1 Pors.") */
    baseLabel: label.default("1 Pors."),
  })
  .refine((v) => (v.price === undefined) !== (v.factor === undefined), { message: "Fiyat ya da çarpandan yalnızca biri verilmeli." });

function fail(res: Response, status: number, error: string) {
  res.status(status).json({ error });
}

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Geçersiz istek.";
}

/** Marka içinde benzersiz retailer_id üretir. */
async function uniqueRetailerId(db: PrismaClient, brandId: number, base: string): Promise<string> {
  const root = base || "urun";
  let candidate = root;
  for (let n = 2; await db.product.findUnique({ where: { brandId_retailerId: { brandId, retailerId: candidate } } }); n++) {
    candidate = `${root}-${n}`;
  }
  return candidate;
}

async function resetHour(db: PrismaClient): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: "dayResetHour" } });
  const hour = Number(row?.value);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_RESET_HOUR;
}

export function productsRouter(db: PrismaClient, onChange: (brandId: number) => void = () => undefined): Router {
  const router = Router();
  router.use(express.json({ limit: "20kb" }));

  router.get("/", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return fail(res, 404, "Marka bulunamadı.");
    const products = await db.product.findMany({
      where: { brandId: brand.id },
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
    const { brandId, name, description, price, categoryId, status } = parsed.data;

    if (!(await db.brand.findUnique({ where: { id: brandId } }))) return fail(res, 400, "Marka bulunamadı.");
    const category = await db.category.findUnique({ where: { id: categoryId } });
    if (!category) return fail(res, 400, "Kategori bulunamadı.");
    if (category.brandId !== brandId) return fail(res, 400, "Bu kategori seçilen markaya ait değil.");

    const last = await db.product.findFirst({ where: { categoryId }, orderBy: { sortOrder: "desc" } });
    const created = await db.product.create({
      data: {
        brandId,
        retailerId: await uniqueRetailerId(db, brandId, slugify(name)),
        name,
        description,
        priceKurus: price,
        categoryId,
        status,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
      include: { category: true },
    });
    onChange(brandId);
    res.status(201).json(toProductDto(created));
  });

  router.patch("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const existing = Number.isInteger(id) ? await db.product.findUnique({ where: { id } }) : null;
    if (!existing) return fail(res, 404, "Ürün bulunamadı.");

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, firstIssue(parsed.error));
    const { price, categoryId, ...rest } = parsed.data;

    if (categoryId !== undefined) {
      const category = await db.category.findUnique({ where: { id: categoryId } });
      if (!category) return fail(res, 400, "Kategori bulunamadı.");
      if (category.brandId !== existing.brandId) return fail(res, 400, "Bu kategori ürünün markasına ait değil.");
    }
    if (rest.variantLabel !== undefined && !existing.groupKey) return fail(res, 400, "Porsiyon adı yalnızca porsiyonlu ürünlerde değiştirilebilir.");

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
    onChange(existing.brandId);
    res.json(toProductDto(updated));
  });

  // Porsiyon (varyant) ekler: aynı yemeğin kendi fiyatı olan yeni bir seçeneği. Katalogda ayrı ürün olarak görünür.
  router.post("/:id/variants", async (req, res) => {
    const id = Number(req.params.id);
    const base = Number.isInteger(id) ? await db.product.findUnique({ where: { id } }) : null;
    if (!base) return fail(res, 404, "Ürün bulunamadı.");
    const parsed = variantSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, firstIssue(parsed.error));
    const { label: newLabel, baseLabel } = parsed.data;
    const price = parsed.data.price ?? portionPrice(base.priceKurus, parsed.data.factor!);

    const groupKey = base.groupKey ?? `g-${base.retailerId}`;
    const siblings = await db.product.findMany({ where: { brandId: base.brandId, groupKey } });
    const labels = new Set([...siblings.map((s) => s.variantLabel?.toLowerCase()), base.variantLabel?.toLowerCase() ?? baseLabel.toLowerCase()]);
    if (labels.has(newLabel.toLowerCase())) return fail(res, 409, "Bu porsiyon zaten var.");

    const created = await db.$transaction(async (tx) => {
      if (!base.groupKey) {
        await tx.product.update({ where: { id: base.id }, data: { groupKey, variantLabel: baseLabel, metaSyncState: "PENDING" } });
      }
      return tx.product.create({
        data: {
          brandId: base.brandId,
          retailerId: await uniqueRetailerId(tx as PrismaClient, base.brandId, slugify(`${base.name} ${newLabel}`)),
          name: base.name,
          groupKey,
          variantLabel: newLabel,
          description: base.description,
          priceKurus: price,
          categoryId: base.categoryId,
          imagePath: base.imagePath, // aynı yemeğin görseli ortak
          status: base.status,
          sortOrder: base.sortOrder,
        },
        include: { category: true },
      });
    });
    onChange(base.brandId);
    res.status(201).json(toProductDto(created));
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
    onChange(product.brandId);
    res.json(toProductDto(updated));
  });

  // Kategori içinde yukarı/aşağı taşı (porsiyonlar yemekle birlikte hareket eder)
  router.post("/:id/move", async (req, res) => {
    const id = Number(req.params.id);
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "direction (up/down) gerekli.");
    const product = Number.isInteger(id) ? await db.product.findUnique({ where: { id } }) : null;
    if (!product) return fail(res, 404, "Ürün bulunamadı.");
    const rows = await db.product.findMany({ where: { categoryId: product.categoryId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, groupKey: true } });
    const moves = moveInOrder(rows, id, parsed.data.direction);
    if (!moves) return res.json({ moved: false });
    await db.$transaction(moves.map((m) => db.product.update({ where: { id: m.id }, data: { sortOrder: m.position } })));
    onChange(product.brandId);
    res.json({ moved: true });
  });

  return router;
}

export function categoriesRouter(db: PrismaClient, onChange: (brandId: number) => void = () => undefined): Router {
  const router = Router();
  router.use(express.json({ limit: "5kb" }));

  router.get("/", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return fail(res, 404, "Marka bulunamadı.");
    const categories = await db.category.findMany({ where: { brandId: brand.id }, orderBy: { sortOrder: "asc" } });
    res.json(categories.map((c) => ({ id: c.id, name: c.name })));
  });

  router.post("/", async (req, res) => {
    const parsed = z.object({ brandId: z.number().int(), name: z.string().trim().min(1, "Kategori adı gerekli.").max(80) }).safeParse(req.body);
    if (!parsed.success) return fail(res, 400, firstIssue(parsed.error));
    const { brandId, name } = parsed.data;
    if (!(await db.brand.findUnique({ where: { id: brandId } }))) return fail(res, 400, "Marka bulunamadı.");
    if (await db.category.findUnique({ where: { brandId_name: { brandId, name } } })) return fail(res, 409, "Bu kategori zaten var.");
    const last = await db.category.findFirst({ where: { brandId }, orderBy: { sortOrder: "desc" } });
    const created = await db.category.create({ data: { brandId, name, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    res.status(201).json({ id: created.id, name: created.name });
  });

  // Kategori sırasını değiştir (Meta'da koleksiyonlar bu sırayla yeniden kurulur)
  router.post("/:id/move", async (req, res) => {
    const id = Number(req.params.id);
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "direction (up/down) gerekli.");
    const category = Number.isInteger(id) ? await db.category.findUnique({ where: { id } }) : null;
    if (!category) return fail(res, 404, "Kategori bulunamadı.");
    const rows = await db.category.findMany({ where: { brandId: category.brandId }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true } });
    const moves = moveInOrder(rows, id, parsed.data.direction);
    if (!moves) return res.json({ moved: false });
    await db.$transaction(moves.map((m) => db.category.update({ where: { id: m.id }, data: { sortOrder: m.position } })));
    onChange(category.brandId);
    res.json({ moved: true });
  });

  return router;
}

/** Birimleri (porsiyonlu yemeğin tüm porsiyonları tek birim) yer değiştirip sortOrder'ı yeniden numaralar. */
export function moveInOrder<T extends { id: number; groupKey?: string | null }>(
  rows: T[],
  id: number,
  direction: "up" | "down",
): { id: number; position: number }[] | null {
  const units = new Map<string, T[]>();
  for (const r of rows) {
    const key = r.groupKey ? `g:${r.groupKey}` : `i:${r.id}`;
    units.set(key, [...(units.get(key) ?? []), r]);
  }
  const list = [...units.values()];
  const from = list.findIndex((u) => u.some((r) => r.id === id));
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= list.length) return null;
  [list[from], list[to]] = [list[to], list[from]];
  return list.flatMap((u, position) => u.map((r) => ({ id: r.id, position })));
}

const moveSchema = z.object({ direction: z.enum(["up", "down"]) });
