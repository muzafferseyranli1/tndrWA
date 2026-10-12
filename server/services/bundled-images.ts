import { randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { logger } from "../lib/logger";

interface Entry {
  category: string;
  name: string;
  file: string;
  /** true: ürünün mevcut görseli (önceki hazır görsel) bununla değiştirilir */
  override?: boolean;
}

const DATA_DIR = path.resolve(process.cwd(), "prisma", "data", "pide-images");

/**
 * Pide menüsünün yerindepide.com'dan alınmış görsellerini ürünlere bir kez bağlar (her grup için `bundled-images.<marka>.<grup>` ayarı ile).
 * Görseli olmayan ürünlere bağlanır (`override` işaretli girişler mevcut hazır görselin yerine geçer); her grup bir kez uygulanır, sonradan panelden silinen/değiştirilen görsel geri gelmez. Hata fırlatmaz.
 */
export async function applyBundledImages(db: PrismaClient, brandCode: string, uploadDir: string): Promise<number> {
  try {
    const manifest = JSON.parse(await readFile(path.join(DATA_DIR, "map.json"), "utf8")) as { batches: { id: string; entries: Entry[] }[] };
    const brand = await db.brand.findUnique({ where: { code: brandCode } });
    if (!brand) return 0;

    const dir = path.resolve(uploadDir);
    await mkdir(dir, { recursive: true });
    let applied = 0;
    for (const batch of manifest.batches) {
      const flag = `bundled-images.${brandCode}.${batch.id}`;
      if (await db.setting.findUnique({ where: { key: flag } })) continue;
      for (const e of batch.entries) {
        if (e.file.includes("/") || e.file.includes("\\")) continue;
        const products = await db.product.findMany({ where: { brandId: brand.id, name: e.name, category: { name: e.category }, ...(e.override ? {} : { imagePath: null }) } });
        if (!products.length) continue;
        const ext = path.extname(e.file).toLowerCase();
        const fileName = `${brandCode}-${path.basename(e.file, ext)}-${randomBytes(4).toString("hex")}${ext}`;
        await copyFile(path.join(DATA_DIR, e.file), path.join(dir, fileName));
        await db.product.updateMany({ where: { id: { in: products.map((p) => p.id) } }, data: { imagePath: fileName, metaSyncState: "PENDING", metaError: null } });
        applied += products.length;
      }
      await db.setting.create({ data: { key: flag, value: new Date().toISOString() } });
      logger.info({ brand: brandCode, batch: batch.id, applied }, "Hazır görseller ürünlere bağlandı");
    }
    return applied;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Hazır görseller bağlanamadı");
    return 0;
  }
}
