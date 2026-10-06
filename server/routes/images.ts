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

export function imagesRouter(db: PrismaClient, uploadDir: string, onChange: () => void): Router {
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
      const product = Number.isInteger(id) ? await db.product.findUnique({ where: { id } }) : null;
      if (!product) return res.status(404).json({ error: "Ürün bulunamadı." });
      if (!req.file) return res.status(400).json({ error: "Görsel dosyası gerekli (alan adı: image)." });

      const img = detectImage(req.file.buffer);
      if (!img) return res.status(400).json({ error: "Yalnızca JPEG veya PNG görsel yüklenebilir." });

      await mkdir(dir, { recursive: true });
      const fileName = `${product.retailerId}-${randomBytes(4).toString("hex")}.${img.ext}`;
      await writeFile(path.join(dir, fileName), req.file.buffer, { flag: "wx" });
      await removeFile(dir, product.imagePath);

      const updated = await db.product.update({
        where: { id },
        data: { imagePath: fileName, metaSyncState: "PENDING", metaError: null },
        include: { category: true },
      });
      onChange();
      res.json({ product: toProductDto(updated), warning: sizeWarning(img) });
    },
  );

  router.delete("/:id/image", async (req, res) => {
    const id = Number(req.params.id);
    const product = Number.isInteger(id) ? await db.product.findUnique({ where: { id } }) : null;
    if (!product) return res.status(404).json({ error: "Ürün bulunamadı." });
    await removeFile(dir, product.imagePath);
    const updated = await db.product.update({
      where: { id },
      data: { imagePath: null, metaSyncState: "PENDING", metaError: null },
      include: { category: true },
    });
    onChange();
    res.json({ product: toProductDto(updated), warning: null });
  });

  return router;
}
