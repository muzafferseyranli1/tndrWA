import assert from "node:assert/strict";
import { test } from "node:test";
import { WahaClient } from "../server/services/waha";
import { compactForLog, isDiscoveryEvent } from "../server/routes/webhooks";

const cfg = { url: "https://waha.example.test", apiKey: "k", hmacKey: "h" };

function fakeWaha(initial: { name: string; status: string } | null) {
  const calls: string[] = [];
  let session = initial;
  const fn = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const key = `${init.method ?? "GET"} ${url.pathname}`;
    calls.push(key);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (key === "GET /api/sessions/tandir") return session ? json(200, session) : json(404, { message: "yok" });
    if (key === "POST /api/sessions/tandir/restart" || key === "POST /api/sessions/tandir/start") {
      session = { name: "tandir", status: "SCAN_QR_CODE" };
      return json(201, session);
    }
    if (key === "POST /api/sessions") {
      session = { name: "tandir", status: "SCAN_QR_CODE" };
      return json(201, session);
    }
    return json(404, {});
  }) as typeof fetch;
  return { client: new WahaClient(cfg, fn), calls };
}

test("FAILED oturum restart ile yeniden başlatılır (start 'zaten çalışıyor' diyor)", async () => {
  const { client, calls } = fakeWaha({ name: "tandir", status: "FAILED" });
  const s = await client.startSession("tandir", "https://x/hook");
  assert.equal(s.status, "SCAN_QR_CODE");
  assert.ok(calls.includes("POST /api/sessions/tandir/restart"));
  assert.ok(!calls.includes("POST /api/sessions/tandir/start"));
});

test("STOPPED oturum start ile başlatılır", async () => {
  const { client, calls } = fakeWaha({ name: "tandir", status: "STOPPED" });
  await client.startSession("tandir", "https://x/hook");
  assert.ok(calls.includes("POST /api/sessions/tandir/start"));
  assert.ok(!calls.includes("POST /api/sessions/tandir/restart"));
});

test("QR bekleyen veya bağlı oturuma dokunulmaz", async () => {
  for (const status of ["SCAN_QR_CODE", "WORKING", "STARTING"]) {
    const { client, calls } = fakeWaha({ name: "tandir", status });
    const s = await client.startSession("tandir", "https://x/hook");
    assert.equal(s.status, status);
    assert.deepEqual(calls.filter((c) => c.startsWith("POST")), [], status);
  }
});

test("oturum yoksa oluşturulur", async () => {
  const { client, calls } = fakeWaha(null);
  await client.startSession("tandir", "https://x/hook");
  assert.ok(calls.includes("POST /api/sessions"));
});

test("keşif günlüğü: sipariş mesajı türü ve JSON anahtarı yakalanır, base64 gürültüsü yakalanmaz", () => {
  assert.equal(isDiscoveryEvent("message.any", "orderMessage", "{}"), true);
  assert.equal(isDiscoveryEvent("message.any", "conversation", "{}"), false);
  assert.equal(isDiscoveryEvent("engine.event", null, '{"Message":{"orderMessage":{"itemCount":2}}}'), true);
  assert.equal(isDiscoveryEvent("engine.event", null, '{"Message":{"ProductMessage":null,"x":1}}'), true);
  // şifreli geçmiş verisi: rastgele harf dizileri, JSON anahtarı değil
  assert.equal(isDiscoveryEvent("engine.event", null, '{"initialHistBootstrapInlinePayload":"eAHtnXt8E9W2xorderQ4hcartfoo9catalog"}'), false);
  assert.equal(isDiscoveryEvent("session.status", null, '{"order":1}'), false);
});

test("günlük kısaltma: uzun base64 küçük resim çıkar, sipariş alanları kalır", () => {
  const raw = JSON.stringify({ event: "engine.event", payload: { data: { Message: { orderMessage: { orderID: "123", itemCount: 2, thumbnail: "A".repeat(5000), totalAmount1000: 200000 } } } } });
  const out = compactForLog(raw);
  assert.ok(out.length < 400, `kısalmalı, uzunluk ${out.length}`);
  assert.ok(out.includes('"orderID":"123"') && out.includes('"itemCount":2') && out.includes('"totalAmount1000":200000'));
  assert.ok(out.includes("<5000 karakter>"));
  assert.equal(compactForLog("json degil".repeat(2000), 50).length, 50);
});
