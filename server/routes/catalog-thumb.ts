import express, { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { resolveBrand } from "../services/brands";
import { getCatalogThumbnail, setCatalogThumbnail } from "../services/catalog-thumb";
import { buildMenuList, getMenuMode, LIST_MAX_ITEMS, LIST_MAX_SECTIONS, MENU_MODES, setMenuMode, type MenuMode } from "../services/menu-message";

/** Panel (yönetici): menü mesajının biçimi (katalog düğmesi / kategorili ürün listesi) ve katalog mesajının üstünde görünen ürün görseli. */
export function catalogThumbRouter(db: PrismaClient): Router {
  const router = Router();
  router.use(express.json({ limit: "2kb" }));

  const view = async (brand: { id: number; code: string; metaCatalogId: string | null }) => {
    const products = await db.product.findMany({ where: { brandId: brand.id, status: "ACTIVE", imagePath: { not: null } }, orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { id: "asc" }], select: { retailerId: true, name: true, variantLabel: true, imagePath: true } });
    const plan = await buildMenuList(db, brand.id);
    return {
      retailerId: await getCatalogThumbnail(db, brand.code),
      products: products.map((p) => ({ retailerId: p.retailerId, name: p.variantLabel ? `${p.name} (${p.variantLabel})` : p.name, imageUrl: `/uploads/${p.imagePath}` })),
      mode: await getMenuMode(db, brand.code),
      list: {
        sections: plan.sections.map((s) => ({ title: s.title, count: s.retailerIds.length })),
        items: plan.items,
        fits: plan.fits && !!brand.metaCatalogId,
        // Tek mesaja sığmıyorsa önce kategori listesi gider
        categories: !plan.fits && plan.items > 0 && !!brand.metaCatalogId,
        reason: brand.metaCatalogId ? plan.reason : "Markanın Meta kataloğu girilmemiş.",
        maxSections: LIST_MAX_SECTIONS,
        maxItems: LIST_MAX_ITEMS,
      },
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
    const parsed = z
      .object({ retailerId: z.string().max(100).nullable().optional(), mode: z.enum(MENU_MODES as [MenuMode, ...MenuMode[]]).optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Geçersiz istek." });
    const { retailerId, mode } = parsed.data;
    if (retailerId) {
      const p = await db.product.findUnique({ where: { brandId_retailerId: { brandId: brand.id, retailerId } } });
      if (!p) return res.status(404).json({ error: "Ürün bulunamadı." });
      if (!p.imagePath || p.status !== "ACTIVE") return res.status(400).json({ error: "Görsel olarak yalnızca görseli olan, aktif bir ürün seçilebilir." });
    }
    if (retailerId !== undefined) await setCatalogThumbnail(db, brand.code, retailerId);
    if (mode) await setMenuMode(db, brand.code, mode);
    res.json(await view(brand));
  });

  return router;
}
