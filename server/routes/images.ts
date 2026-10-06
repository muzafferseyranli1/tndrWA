import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { detectImage, sizeWarning } from "../lib/image";
import { toProductDto } from "../services/product-dto";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });

async function removeFile(dir: string, name: string | null) {
  if (!name || name.includes("/") || name.includes("\\")) return;
  await unlink(path.join(dir, name)).catch(() => undefined);
}

/** Görsel, aynı yemeğin tüm porsiyonları için ortaktır; porsiyonsuz üründe yalnızca kendisi. */
async function targetIds(db: PrismaClient, product: { id: number; brandId: number; groupKey: string | null }): Promise<number[]> {
  if (!product.groupKey) return [product.id];
  const group = await db.product.findMany({ where: { brandId: product.brandId, groupKey: product.groupKey }, select: { id: true } });
  return group.map((g) => g.id);
}

/** Artık hiçbir ürünün kullanmadığı eski görsel dosyalarını siler. */
async function cleanupOrphans(db: PrismaClient, dir: string, names: (string | null)[]) {
  for (const name of new Set(names)) {
    if (name && (await db.product.count({ where: { imagePath: name } })) === 0) await removeFile(dir, name);
  }
}

export function imagesRouter(db: PrismaClient, uploadDir: string, onChange: (brandId: number) => void): Router {
  const router = Router();
  const dir = path.resolve(uploadDir);

  router.post(
    "/:id/image",
    (req: Request, res: Response, next: NextFunction) => {
      upload.single("image")(req, res, (err: unknown) => {
        if (!err) return next();
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: `Görsel en fazla ${MAX_IMAGE_BYTES / 1024 / 1024} MB olabilir.` });
        }
        return res.status(400).json({ error: "Görsel yüklenemedi." });
      });
    },
    async (req, res) => {
      const id = Number(req.params.id);
      const product = Number.isInteger(id) ? await db.product.findUnique({ where: { id }, include: { brand: true } }) : null;
      if (!product) return res.status(404).json({ error: "Ürün bulunamadı." });
      if (!req.file) return res.status(400).json({ error: "Görsel dosyası gerekli (alan adı: image)." });

      const img = detectImage(req.file.buffer);
      if (!img) return res.status(400).json({ error: "Yalnızca JPEG veya PNG görsel yüklenebilir." });

      await mkdir(dir, { recursive: true });
      // Marka kodu öneki: iki markada aynı retailerId olsa da dosya adları çakışmaz
      const fileName = `${product.brand.code}-${product.retailerId}-${randomBytes(4).toString("hex")}.${img.ext}`;
      await writeFile(path.join(dir, fileName), req.file.buffer, { flag: "wx" });

      const ids = await targetIds(db, product);
      const old = (await db.product.findMany({ where: { id: { in: ids } }, select: { imagePath: true } })).map((p) => p.imagePath);
      await db.product.updateMany({ where: { id: { in: ids } }, data: { imagePath: fileName, metaSyncState: "PENDING", metaError: null } });
      await cleanupOrphans(db, dir, old);

      const updated = await db.product.findUniqueOrThrow({ where: { id }, include: { category: true } });
      onChange(product.brandId);
      res.json({ product: toProductDto(updated), warning: sizeWarning(img) });
    },
  );

  router.delete("/:id/image", async (req, res) => {
    const id = Number(req.params.id);
    const product = Number.isInteger(id) ? await db.product.findUnique({ where: { id } }) : null;
    if (!product) return res.status(404).json({ error: "Ürün bulunamadı." });

    const ids = await targetIds(db, product);
    const old = (await db.product.findMany({ where: { id: { in: ids } }, select: { imagePath: true } })).map((p) => p.imagePath);
    await db.product.updateMany({ where: { id: { in: ids } }, data: { imagePath: null, metaSyncState: "PENDING", metaError: null } });
    await cleanupOrphans(db, dir, old);

    const updated = await db.product.findUniqueOrThrow({ where: { id }, include: { category: true } });
    onChange(product.brandId);
    res.json({ product: toProductDto(updated), warning: null });
  });

  return router;
}
