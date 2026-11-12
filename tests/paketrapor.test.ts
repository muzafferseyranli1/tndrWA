import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { RAPOR_CSP, paketRaporPageRouter, paketRaporUploadRouter, reportFile, tokenValid } from "../server/routes/paketrapor";

const TOKEN = "t".repeat(40);
const HTML = "<!doctype html><html><body>rapor</body></html>";

test("jeton: doğru jeton geçer, kısa/yanlış/eksik jeton geçmez", () => {
  assert.equal(tokenValid(TOKEN, `Bearer ${TOKEN}`), true);
  assert.equal(tokenValid(TOKEN, `Bearer ${TOKEN}x`), false);
  assert.equal(tokenValid(TOKEN, TOKEN), false);
  assert.equal(tokenValid(TOKEN, undefined), false);
  assert.equal(tokenValid("kisa", "Bearer kisa"), false);
  assert.equal(tokenValid(undefined, `Bearer ${TOKEN}`), false);
});

async function sunucu(token: string | undefined, role: string | undefined) {
  const dir = await mkdtemp(path.join(tmpdir(), "paketrapor-"));
  const app = express();
  app.use("/api/paketrapor", paketRaporUploadRouter(dir, token));
  app.use((_req, res, next) => {
    if (role) res.locals.role = role;
    next();
  });
  app.use("/paketrapor", paketRaporPageRouter(dir));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { dir, base, kapat: async () => { server.close(); await rm(dir, { recursive: true, force: true }); } };
}

const yukle = (base: string, body: string, auth?: string) =>
  fetch(`${base}/api/paketrapor`, { method: "PUT", headers: { "Content-Type": "text/html", ...(auth ? { Authorization: auth } : {}) }, body });

test("yükleme: jetonsuz 401, yanlış içerik 400, doğru yükleme dosyaya yazılır ve yöneticiye sunulur", async () => {
  const s = await sunucu(TOKEN, "ADMIN");
  try {
    assert.equal((await fetch(`${s.base}/paketrapor`)).status, 404); // henüz rapor yok
    assert.equal((await yukle(s.base, HTML)).status, 401);
    assert.equal((await yukle(s.base, HTML, "Bearer yanlis")).status, 401);
    assert.equal((await yukle(s.base, "merhaba", `Bearer ${TOKEN}`)).status, 400);
    const ok = await yukle(s.base, HTML, `Bearer ${TOKEN}`);
    assert.equal(ok.status, 200);
    assert.equal(await readFile(reportFile(s.dir), "utf8"), HTML);
    const sayfa = await fetch(`${s.base}/paketrapor`);
    assert.equal(sayfa.status, 200);
    assert.equal(await sayfa.text(), HTML);
    assert.equal(sayfa.headers.get("content-security-policy"), RAPOR_CSP);
    assert.equal(sayfa.headers.get("cache-control"), "no-store");
  } finally {
    await s.kapat();
  }
});

test("jeton tanımlı değilse yükleme kapalı (503)", async () => {
  const s = await sunucu(undefined, "ADMIN");
  try {
    assert.equal((await yukle(s.base, HTML, `Bearer ${TOKEN}`)).status, 503);
  } finally {
    await s.kapat();
  }
});

test("yönetici olmayan rapor sayfasını göremez", async () => {
  const s = await sunucu(TOKEN, "USER");
  try {
    await yukle(s.base, HTML, `Bearer ${TOKEN}`);
    const r = await fetch(`${s.base}/paketrapor`, { redirect: "manual" });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), "/orders");
  } finally {
    await s.kapat();
  }
});
