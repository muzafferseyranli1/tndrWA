import express, { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { BrandDto } from "../../shared/types";

export function brandsRouter(db: PrismaClient): Router {
  const router = Router();
  router.use(express.json({ limit: "5kb" }));

  router.get("/", async (_req, res) => {
    const brands = await db.brand.findMany({ orderBy: { sortOrder: "asc" }, include: { _count: { select: { products: true } } } });
    const dto: BrandDto[] = brands.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      metaCatalogId: b.metaCatalogId,
      waSession: b.waSession,
      productCount: b._count.products,
    }));
    res.json(dto);
  });

  // Marka ayarları. İkinci markanın Meta kataloğu hazır olduğunda buradan katalog kimliği girilir.
  router.patch("/:id", async (req, res) => {
    const id = Number(req.params.id);
    const brand = Number.isInteger(id) ? await db.brand.findUnique({ where: { id } }) : null;
    if (!brand) return res.status(404).json({ error: "Marka bulunamadı." });

    const parsed = z
      .object({
        name: z.string().trim().min(1).max(80),
        // Boş gönderilirse temizlenir
        metaCatalogId: z.union([z.string().trim().regex(/^\d{5,25}$/, "Katalog kimliği yalnızca rakamlardan oluşur."), z.literal("")]),
        waSession: z.union([z.string().trim().regex(/^[a-z0-9_-]{1,40}$/, "Oturum adı küçük harf, rakam, - ve _ içerebilir."), z.literal("")]),
      })
      .partial()
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Geçersiz istek." });

    const { metaCatalogId, waSession, name } = parsed.data;
    const updated = await db.brand.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(metaCatalogId !== undefined ? { metaCatalogId: metaCatalogId || null } : {}),
        ...(waSession !== undefined ? { waSession: waSession || null } : {}),
      },
    });
    // Katalog değiştiyse bu markanın ürünlerinin hiçbiri yeni katalogda değil: yeniden gönderilmeli
    if (metaCatalogId !== undefined && (metaCatalogId || null) !== brand.metaCatalogId) {
      await db.product.updateMany({ where: { brandId: id }, data: { onMeta: false, metaSyncState: "PENDING", metaError: null } });
    }
    res.json({ id: updated.id, code: updated.code, name: updated.name, metaCatalogId: updated.metaCatalogId, waSession: updated.waSession });
  });

  return router;
}
