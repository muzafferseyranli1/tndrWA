import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { detectAudio } from "../lib/audio";

export const MAX_SOUND_BYTES = 2 * 1024 * 1024;
const KEY = "orderSound";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SOUND_BYTES, files: 1 } });

/** Yeni sipariş uyarı sesi: yüklenmişse dosya adresi, yoksa null (panel yerleşik sesi çalar). */
export function soundRouter(db: PrismaClient, uploadDir: string): Router {
  const router = Router();
  const dir = path.join(path.resolve(uploadDir), "sounds");

  const current = async () => (await db.setting.findUnique({ where: { key: KEY } }))?.value ?? null;
  const remove = async (name: string | null) => {
    if (name && !name.includes("/") && !name.includes("\\")) await unlink(path.join(dir, name)).catch(() => undefined);
  };
  const dto = (name: string | null) => ({ url: name ? `/uploads/sounds/${name}` : null });

  router.get("/", async (_req, res) => res.json(dto(await current())));

  router.post(
    "/",
    (req: Request, res: Response, next: NextFunction) => {
      upload.single("sound")(req, res, (err: unknown) => {
        if (!err) return next();
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: `Ses dosyası en fazla ${MAX_SOUND_BYTES / 1024 / 1024} MB olabilir.` });
        return res.status(400).json({ error: "Ses dosyası yüklenemedi." });
      });
    },
    async (req, res) => {
      if (!req.file) return res.status(400).json({ error: "Ses dosyası gerekli (alan adı: sound)." });
      const audio = detectAudio(req.file.buffer);
      if (!audio) return res.status(400).json({ error: "Yalnızca MP3, WAV, OGG veya M4A ses dosyası yüklenebilir." });
      await mkdir(dir, { recursive: true });
      const name = `alert-${randomBytes(6).toString("hex")}.${audio.ext}`;
      await writeFile(path.join(dir, name), req.file.buffer, { flag: "wx" });
      const old = await current();
      await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: name }, update: { value: name } });
      await remove(old);
      res.json(dto(name));
    },
  );

  router.delete("/", async (_req, res) => {
    const old = await current();
    await db.setting.deleteMany({ where: { key: KEY } });
    await remove(old);
    res.json(dto(null));
  });

  return router;
}
