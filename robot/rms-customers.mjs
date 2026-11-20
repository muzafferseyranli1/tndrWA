// RMS (suitablerms.com) müşteri listesini her gün indirip yrndWA paneline gönderen robot.
//
// Ortam değişkenleri (Coolify'da gizli olarak girilir, koda/sohbete yazılmaz):
//   RMS_USER, RMS_PASS     RMS'te yalnız bu iş için açılmış kullanıcı (e-posta + şifre)
//   IMPORT_TOKEN           panelin IMPORT_TOKEN değeriyle aynı olmalı
//   PANEL_URL              varsayılan https://yerinde.derinsoft.com.tr
//   RUN_AT                 günlük çalışma saati (Türkiye saati, "HH:MM"), varsayılan 04:30
//   RUN_ON_START=1         açılışta bir kez hemen çalış
//   SETTLE_MS              girişten sonra uygulamanın oturması için bekleme (ms), varsayılan 30000
//   HEADED=1               (yalnız kendi bilgisayarınızda deneme) tarayıcıyı görünür aç
//
// Kullanım: `node rms-customers.mjs` günlük döngü, `node rms-customers.mjs --once` tek seferlik çalışma.
import { chromium } from "playwright";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const RMS_URL = "https://suitablerms.com/app";
const PANEL = (process.env.PANEL_URL || "https://yerinde.derinsoft.com.tr").replace(/\/+$/, "");
const TOKEN = process.env.IMPORT_TOKEN || "";
const EXPORT_TIMEOUT_MS = 6 * 60_000; // RMS 29 bin kaydı sunucuda hazırlıyor: 1-2 dk sürebilir
const log = (...a) => console.log(new Date().toISOString(), ...a);

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} tanımlı değil`);
  return v;
}

async function panel(pathname, init = {}) {
  const res = await fetch(PANEL + pathname, { ...init, headers: { "x-robot-token": TOKEN, ...(init.headers || {}) } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* gövde JSON değil */
  }
  if (!res.ok) throw new Error(`Panel ${pathname} ${res.status}: ${json?.error || text.slice(0, 120)}`);
  return json;
}

async function report(ok, message) {
  try {
    await panel("/api/robot/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ok, message }) });
  } catch (e) {
    log("Panele bildirilemedi:", e.message);
  }
}

async function ensureLoggedIn(page) {
  await page.goto(RMS_URL, { waitUntil: "domcontentloaded" });
  const menu = page.getByRole("button", { name: "Sadakat Yönetimi" });
  const loginBtn = page.getByRole("button", { name: "Giriş Yap" }).first();
  // Oturum varsa menü, yoksa giriş düğmesi görünür
  await Promise.race([menu.waitFor({ timeout: 30_000 }), loginBtn.waitFor({ timeout: 30_000 })]).catch(() => undefined);
  if (await menu.count()) return;

  await loginBtn.click();
  await page.locator('input[type="password"]').first().waitFor({ timeout: 15_000 });
  await page.locator('input[type="email"], input[type="text"]').first().fill(need("RMS_USER"));
  await page.locator('input[type="password"]').first().fill(need("RMS_PASS"));
  await page.getByRole("button", { name: "Giriş Yap" }).last().click();
  try {
    await menu.waitFor({ timeout: 45_000 });
  } catch {
    throw new Error("RMS'e giriş yapılamadı (şifre değişmiş, doğrulama kodu ya da robot kontrolü istenmiş olabilir)");
  }
}

/** Hata anında sayfada ne görüldüğünü yazar (mod, ilgili menü düğmeleri) ve ekran görüntüsü kaydeder */
async function menuFailure(page, dir, message) {
  const info = await page
    .evaluate(() => {
      const text = document.body.innerText;
      const mode = (text.match(/(Merkez|Şube) Modu/) || [])[0] || "mod bilinmiyor";
      const closed = text.includes("kapalı");
      const buttons = [...document.querySelectorAll("*")]
        .filter((e) => e.children.length === 0 && /Müşteri|Sadakat|Kampanya|Kupon/.test(e.textContent || ""))
        .map((e) => `${e.textContent.trim().slice(0, 30)}<${e.tagName.toLowerCase()}${e.getBoundingClientRect().height > 0 ? "" : ",gizli"}>`);
      return { mode, closed, buttons: [...new Set(buttons)].slice(0, 12), url: location.pathname };
    })
    .catch(() => ({ mode: "?", closed: false, buttons: [], url: "?" }));
  const shot = path.join(process.cwd(), "hata.png"); // geçici klasör iş bitince silindiği için kalıcı yere
  await page.screenshot({ path: shot, fullPage: false }).catch(() => undefined);
  throw new Error(`${message}. Sayfa: ${info.url}, ${info.mode}${info.closed ? ", 'kapalı' uyarısı var" : ""}, görünen düğmeler: [${info.buttons.join(" | ")}], ekran görüntüsü: ${shot}`);
}

/**
 * RMS giriş sonrası önce yeni sürümü indirip sayfayı yeniliyor, sonra ~20 sn daha hazırlanıyor:
 * yenileme gelirse beklenir, ardından uygulamanın oturması için süre tanınır. Sağ alttaki "yeni sürüm" bildirimi tıklamaları kapattığı için gizlenir.
 */
async function settle(page) {
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(6_000);
  if (await page.locator(".update-toast").isVisible().catch(() => false)) {
    log("RMS güncelleme yenilemesi bekleniyor");
    await page.waitForEvent("load", { timeout: 45_000 }).catch(() => undefined);
  }
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(Number(process.env.SETTLE_MS) || 30_000); // uygulamanın oturması için (RMS ~20 sn istiyor, pay bırakıldı)
  await page.addStyleTag({ content: ".Toastify{display:none !important}" }).catch(() => undefined);
}

async function downloadExcel(page, dir) {
  // Güncelleme yenilemesi sırasında öğeler kaybolabiliyor: tümünü baştan en fazla 3 kez dene
  for (let attempt = 1; ; attempt++) {
    try {
      await settle(page);
      await openCustomers(page, dir);
      return await exportExcel(page, dir);
    } catch (e) {
      if (attempt >= 3) throw e;
      log(`Deneme ${attempt} başarısız (${e.message.split("\n")[0]}), yeniden deneniyor`);
      await page.goto(RMS_URL, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
  }
}

async function openCustomers(page, dir) {
  // Doğrudan adres ana sayfaya atıyor: menüden gidilir
  // Menü öğeleri gerçek <button> değil (role=button): metne göre aranır; yalnız görünür olan alınır
  const sadakat = page.locator('text="Sadakat Yönetimi" >> visible=true').first();
  const customers = page.locator('text="Müşteriler" >> visible=true').first();
  await sadakat.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
  // Önce menü arama kutusu: "müşteriler" yazınca "Müşteriler (Satış Yönetimi / Sadakat Yönetimi)" sonucu çıkar
  const search = page.getByPlaceholder("Menüde ara...");
  if (await search.count()) {
    await search.first().fill("müşteriler");
    await customers.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
  }
  // Arama çalışmadıysa yedek: alt menü zaten açık olabilir (tekrar tıklamak kapatır), görünür değilse aç, olmadıysa tekrar dene
  for (let i = 0; i < 4 && !(await customers.isVisible()); i++) {
    await sadakat.scrollIntoViewIfNeeded().catch(() => undefined);
    await sadakat.click({ timeout: 10_000 }).catch(() => undefined);
    await customers.waitFor({ state: "visible", timeout: 4_000 }).catch(() => undefined);
  }
  if (!(await customers.isVisible())) await menuFailure(page, dir, "Menüde 'Müşteriler' bulunamadı");
  await customers.click();
  try {
    await page.getByText("Toplam Müşteri").waitFor({ timeout: 60_000 });
  } catch {
    await menuFailure(page, dir, "Müşteriler sayfası açılmadı (yetki ya da modül kapalı olabilir)");
  }
}

async function exportExcel(page, dir) {
  // "Excel'e Aktar": kapsamdaki TÜM müşteriler (ekrandaki limitli listeden bağımsız). "Excelden Aktar" ayrı düğme, karışmasın
  const exportBtn = page.getByRole("button", { name: /Excel'e Aktar|Kapsamdaki TÜM/ }).first();
  await exportBtn.waitFor({ state: "visible", timeout: 30_000 });
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: EXPORT_TIMEOUT_MS }), exportBtn.click({ timeout: 15_000 })]);
  const file = path.join(dir, "musteri.xlsx");
  await dl.saveAs(file);
  return file;
}

async function sendToPanel(file) {
  const buf = await readFile(file);
  if (buf.length < 100_000) throw new Error(`İndirilen dosya çok küçük (${buf.length} bayt): liste boş olabilir`);
  const form = new FormData();
  form.append("file", new Blob([buf]), "musteri-listesi.xlsx");
  const { jobId } = await panel("/api/robot/customers", { method: "POST", body: form });
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const job = await panel(`/api/robot/customers/${jobId}`);
    if (job.state === "done") return job.stats;
    if (job.state === "failed") throw new Error(`Panel içe aktaramadı: ${job.error}`);
  }
  throw new Error("İçe aktarma 20 dakikada bitmedi");
}

export async function runOnce() {
  if (!TOKEN) throw new Error("IMPORT_TOKEN tanımlı değil");
  need("RMS_USER");
  need("RMS_PASS");
  const dir = await mkdtemp(path.join(tmpdir(), "rms-"));
  const browser = await chromium.launch({ headless: process.env.HEADED !== "1", args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({ acceptDownloads: true, locale: "tr-TR", viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(30_000);
    log("RMS'e giriliyor");
    await ensureLoggedIn(page);
    log("Müşteri Excel'i isteniyor (1-2 dk sürebilir)");
    const file = await downloadExcel(page, dir);
    log("Panele gönderiliyor");
    const s = await sendToPanel(file);
    log("Bitti", s);
    // Başarı bildirimi içe aktarmayı bitiren panel tarafından yazılır (sayılarla); burada ek bildirim yok
  } finally {
    await browser.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function safeRun() {
  try {
    await runOnce();
    return true;
  } catch (e) {
    log("HATA:", e.message);
    await report(false, e.message);
    return false;
  }
}

/** Türkiye saatiyle bir sonraki "HH:MM"e kalan ms (Türkiye UTC+3, yaz saati yok) */
function msUntil(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(h - 3, m, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next - now;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  if (process.argv.includes("--once")) {
    process.exit((await safeRun()) ? 0 : 1);
  } else {
    const at = process.env.RUN_AT || "04:30";
    log(`Robot açıldı; her gün ${at} (Türkiye saati) çalışacak`);
    if (process.env.RUN_ON_START === "1") await safeRun();
    for (;;) {
      const wait = msUntil(at);
      log(`Sonraki çalışma ${Math.round(wait / 60000)} dk sonra`);
      await new Promise((r) => setTimeout(r, wait));
      await safeRun();
    }
  }
}
