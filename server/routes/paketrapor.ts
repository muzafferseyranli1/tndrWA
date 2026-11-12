import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import express, { Router } from "express";

/**
 * Paket servis raporu (/paketrapor).
 * Rapor yerelde üretilir (Yrndpaket: fatura_analiz.py + rapor.py) ve tek dosyalık HTML olarak buraya yüklenir:
 * PUT /api/paketrapor, "Authorization: Bearer <PAKETRAPOR_TOKEN>". Dosya kalıcı diskte tutulur (üretimde /data/paketrapor).
 * Sayfayı yalnız oturum açmış yönetici görür; veri güncellemek için deploy gerekmez.
 */

/** Rapor dış kaynak kullanmaz: yalnız kendi satır içi stil ve betiği çalışır, hiçbir yere istek atamaz. */
export const RAPOR_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const AZAMI_BOYUT = "5mb";

const BOS_SAYFA = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paket servis raporu</title></head><body style="font:16px system-ui,sans-serif;margin:40px">
<h1>Paket servis raporu</h1><p>Henüz rapor yüklenmedi.</p></body></html>`;

/** Jeton en az 32 karakter olmalı; karşılaştırma sabit sürede yapılır. */
export function tokenValid(expected: string | undefined, authorization: string | undefined): boolean {
  if (!expected || expected.length < 32 || !authorization?.startsWith("Bearer ")) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(expected), h(authorization.slice(7).trim()));
}

export function reportFile(dir: string): string {
  return path.join(dir, "index.html");
}

/** Yükleme ucu: oturum çerezi yok, jetonla doğrulanır (requireAuth'tan ÖNCE bağlanmalı). */
export function paketRaporUploadRouter(dir: string, token: string | undefined): Router {
  const router = Router();
  router.put("/", express.text({ type: () => true, limit: AZAMI_BOYUT }), async (req, res) => {
    if (!token) return void res.status(503).json({ error: "PAKETRAPOR_TOKEN tanımlı değil: yükleme kapalı." });
    if (!tokenValid(token, req.headers.authorization)) return void res.status(401).json({ error: "Geçersiz jeton." });
    const html = typeof req.body === "string" ? req.body : "";
    if (!/^\s*<!doctype html/i.test(html)) return void res.status(400).json({ error: "Tek dosyalık HTML rapor bekleniyor." });
    await mkdir(dir, { recursive: true });
    const target = reportFile(dir);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, html, "utf8");
    await rename(tmp, target); // yarım yazılmış dosya hiç sunulmaz
    res.json({ ok: true, bytes: Buffer.byteLength(html, "utf8") });
  });
  return router;
}

/** Sayfa: requireAuth'tan SONRA bağlanır; yalnız yönetici. */
export function paketRaporPageRouter(dir: string): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    if (res.locals.role !== "ADMIN") return void res.redirect("/orders");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", RAPOR_CSP);
    try {
      res.type("html").send(await readFile(reportFile(dir), "utf8"));
    } catch {
      res.status(404).type("html").send(BOS_SAYFA);
    }
  });
  return router;
}
