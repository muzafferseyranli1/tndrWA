import express, { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { resolveBrand } from "../services/brands";
import { getCatalogThumbnail, setCatalogThumbnail } from "../services/catalog-thumb";

/** Panel (yönetici): katalog mesajının üstünde görünen ürün görselini seçer. */
export function catalogThumbRouter(db: PrismaClient): Router {
  const router = Router();
  router.use(express.json({ limit: "2kb" }));

  const view = async (brand: { id: number; code: string }) => {
    const products = await db.product.findMany({ where: { brandId: brand.id, status: "ACTIVE", imagePath: { not: null } }, orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { id: "asc" }], select: { retailerId: true, name: true, variantLabel: true, imagePath: true } });
    return {
      retailerId: await getCatalogThumbnail(db, brand.code),
      products: products.map((p) => ({ retailerId: p.retailerId, name: p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name, imageUrl: `/uploads/${p.imagePath}` })),
    };
  };

  router.get("/", async (req, res) => {
    const brand = await resolveBrand(db, req.query.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    res.json(await view(brand));
  });

  router.put("/", async (req, res) => {
    const brand = await resolveBrand(db, req.body?.brandId);
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });
    const parsed = z.object({ retailerId: z.string().max(100).nullable() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Geçersiz istek." });
    if (parsed.data.retailerId) {
      const p = await db.product.findUnique({ where: { brandId_retailerId: { brandId: brand.id, retailerId: parsed.data.retailerId } } });
      if (!p) return res.status(404).json({ error: "Ürün bulunamadı." });
      if (!p.imagePath || p.status !== "ACTIVE") return res.status(400).json({ error: "Görsel olarak yalnızca görseli olan, aktif bir ürün seçilebilir." });
    }
    await setCatalogThumbnail(db, brand.code, parsed.data.retailerId);
    res.json(await view(brand));
  });

  return router;
}
