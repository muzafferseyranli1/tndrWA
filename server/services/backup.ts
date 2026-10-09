import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import * as tar from "tar";
import type { PrismaClient } from "@prisma/client";

export interface BackupFile {
  name: string;
  kind: "db" | "uploads";
  sizeBytes: number;
  createdAt: string;
}

export const BACKUP_NAME = /^tndrwa-(db|uploads)-\d{8}-\d{4}\.(db\.gz|tar\.gz)$/;
/** Bu süreden eski yedekler silinir; her türden en yeni KEEP_MIN dosya ise her koşulda kalır. */
export const KEEP_DAYS = 14;
const KEEP_MIN = 3;
/** Türkiye saati (UTC+3): yedek günlük 04:00'ten sonra alınır, sabah müşteri yokken. */
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;
const BACKUP_HOUR = 4;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Dosya adı için Türkiye saatiyle zaman damgası: 20261009-0405 */
export function stamp(now: Date): string {
  const t = new Date(now.getTime() + ISTANBUL_OFFSET_MS);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}-${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}`;
}

/** Bugünün (Türkiye saatiyle) yedeği alınmış mı, ve şimdi yedek saati geçti mi? */
export function backupDue(files: BackupFile[], now: Date): boolean {
  const local = new Date(now.getTime() + ISTANBUL_OFFSET_MS);
  if (local.getUTCHours() < BACKUP_HOUR) return false;
  const today = stamp(now).slice(0, 8);
  return !files.some((f) => f.kind === "db" && f.name.slice("tndrwa-db-".length, "tndrwa-db-".length + 8) === today);
}

export interface BackupStatus {
  running: boolean;
  lastError: string | null;
  lastRunAt: string | null;
}

/** SQLite veritabanının tutarlı bir kopyasını (VACUUM INTO) ve yüklenen görselleri sıkıştırarak yedek klasörüne yazar. */
export class BackupService {
  private running = false;
  private lastError: string | null = null;
  private lastRunAt: string | null = null;

  constructor(
    private readonly db: PrismaClient,
    readonly backupDir: string,
    private readonly uploadDir: string,
  ) {}

  status(): BackupStatus {
    return { running: this.running, lastError: this.lastError, lastRunAt: this.lastRunAt };
  }

  async list(): Promise<BackupFile[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.backupDir);
    } catch {
      return [];
    }
    const out: BackupFile[] = [];
    for (const name of names) {
      const m = BACKUP_NAME.exec(name);
      if (!m) continue;
      const st = await stat(path.join(this.backupDir, name));
      out.push({ name, kind: m[1] as "db" | "uploads", sizeBytes: st.size, createdAt: st.mtime.toISOString() });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** İndirme için güvenli dosya yolu; adı doğrulanamazsa null (yol gezme yok). */
  pathFor(name: string): string | null {
    return BACKUP_NAME.test(name) ? path.join(this.backupDir, name) : null;
  }

  async run(now = new Date()): Promise<BackupFile[]> {
    if (this.running) throw new Error("Bir yedekleme zaten sürüyor.");
    this.running = true;
    try {
      await mkdir(this.backupDir, { recursive: true });
      const s = stamp(now);
      const created: string[] = [];

      // 1) Veritabanı: çalışırken tutarlı anlık görüntü, sonra sıkıştır
      const tmp = path.join(this.backupDir, `.tmp-${s}.db`);
      await rm(tmp, { force: true });
      if (!/^[\w./:\\-]+$/.test(tmp) || tmp.includes("'")) throw new Error("Yedek klasörü yolu geçersiz karakter içeriyor.");
      await this.db.$executeRawUnsafe(`VACUUM INTO '${tmp.replace(/\\/g, "/")}'`);
      const dbName = `tndrwa-db-${s}.db.gz`;
      await pipeline(createReadStream(tmp), createGzip(), createWriteStream(path.join(this.backupDir, dbName)));
      await rm(tmp, { force: true });
      created.push(dbName);

      // 2) Yüklenen görseller ve ses dosyası (klasör varsa)
      const upDir = path.resolve(this.uploadDir);
      const exists = await stat(upDir).then((x) => x.isDirectory()).catch(() => false);
      if (exists) {
        const upName = `tndrwa-uploads-${s}.tar.gz`;
        await tar.c({ gzip: true, cwd: path.dirname(upDir), file: path.join(this.backupDir, upName) }, [path.basename(upDir)]);
        created.push(upName);
      }

      await this.prune(now);
      this.lastError = null;
      this.lastRunAt = now.toISOString();
      return (await this.list()).filter((f) => created.includes(f.name));
    } catch (err) {
      this.lastError = (err as Error).message;
      throw err;
    } finally {
      this.running = false;
    }
  }

  /** KEEP_DAYS günden eski yedekleri siler; her türün en yeni KEEP_MIN dosyası kalır. */
  async prune(now = new Date()): Promise<number> {
    const files = await this.list();
    const cutoff = now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const kind of ["db", "uploads"] as const) {
      const ofKind = files.filter((f) => f.kind === kind); // yeniden eskiye
      for (const f of ofKind.slice(KEEP_MIN)) {
        if (new Date(f.createdAt).getTime() < cutoff) {
          await rm(path.join(this.backupDir, f.name), { force: true });
          removed++;
        }
      }
    }
    return removed;
  }
}
