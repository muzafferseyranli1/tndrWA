import assert from "node:assert/strict";
import { test } from "node:test";
import { MetaApiError, MetaCatalogClient, buildItemData, type ItemSource } from "../server/services/meta-catalog";

const cfg = { version: "v23.0", catalogId: "999", token: "SECRET-TOKEN-VALUE", baseUrl: "https://graph.example.test" };
const noSleep = async () => undefined;

const product: ItemSource = {
  retailerId: "tandir-tabagi-100-g",
  name: "Tandır Tabağı (100 g)",
  description: "100 g kuzu tandır",
  priceKurus: 99900,
  imagePath: "tandir-tabagi-100-g-ab12cd34.jpg",
  category: { name: "Et Tandırlar" },
};

function fakeFetch(handler: (url: URL, init: RequestInit) => { status?: number; body: unknown }): { fn: typeof fetch; calls: { url: URL; init: RequestInit }[] } {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}

test("ürün verisi: liste fiyatı, stok durumu, kategori ve herkese açık görsel adresi", () => {
  const data = buildItemData(product, true, "https://tndrwa.example.com");
  assert.deepEqual(data, {
    id: "tandir-tabagi-100-g",
    title: "Tandır Tabağı (100 g)",
    description: "100 g kuzu tandır",
    availability: "in stock",
    condition: "new",
    price: "999.00 TRY",
    link: "https://tndrwa.example.com",
    image_link: "https://tndrwa.example.com/uploads/tandir-tabagi-100-g-ab12cd34.jpg",
    brand: "Yerinde Tandır",
    product_type: "Et Tandırlar",
  });
  assert.equal(buildItemData(product, false, "https://x.test")?.availability, "out of stock");
});

test("görselsiz ürün için veri üretilmez; boş açıklamada ad kullanılır", () => {
  assert.equal(buildItemData({ ...product, imagePath: null }, true, "https://x.test"), null);
  assert.equal(buildItemData({ ...product, description: "" }, true, "https://x.test")?.description, product.name);
});

test("batch gönderilir, bitene kadar sorgulanır, jeton URL'ye değil başlığa konur", async () => {
  let polls = 0;
  const { fn, calls } = fakeFetch((url) => {
    if (url.pathname.endsWith("/items_batch")) return { body: { handles: ["H1"] } };
    polls++;
    return { body: { data: [{ status: polls < 3 ? "in_progress" : "finished", errors: [] }] } };
  });
  const client = new MetaCatalogClient(cfg, fn, noSleep);
  const handle = await client.submitBatch([{ method: "DELETE", data: { id: "a" } }]);
  assert.equal(handle, "H1");
  const result = await client.waitForBatch(handle);
  assert.deepEqual(result, { status: "finished", errors: [] });
  assert.equal(polls, 3);

  const post = calls[0];
  assert.equal(post.url.href, "https://graph.example.test/v23.0/999/items_batch");
  assert.equal(post.init.method, "POST");
  const body = new URLSearchParams(String(post.init.body));
  assert.equal(body.get("item_type"), "PRODUCT_ITEM");
  assert.deepEqual(JSON.parse(body.get("requests")!), [{ method: "DELETE", data: { id: "a" } }]);
  for (const c of calls) {
    assert.ok(!c.url.href.includes("SECRET"), "jeton URL'de olmamalı");
    assert.equal((c.init.headers as Record<string, string>).Authorization, "Bearer SECRET-TOKEN-VALUE");
  }
});

test("ürün bazlı Meta hataları id ile döner", async () => {
  const { fn } = fakeFetch(() => ({ body: { data: [{ status: "finished", errors: [{ id: "a", message: "Görsel indirilemedi" }], errors_total_count: 1 }] } }));
  const result = await new MetaCatalogClient(cfg, fn, noSleep).waitForBatch("H");
  assert.deepEqual(result.errors, [{ id: "a", message: "Görsel indirilemedi" }]);
});

test("ayrıntısız hata sayısı geçersiz id listesinden doldurulur", async () => {
  const { fn } = fakeFetch(() => ({ body: { data: [{ status: "finished", errors: [], errors_total_count: 2, ids_of_invalid_requests: ["a", "b"] }] } }));
  const result = await new MetaCatalogClient(cfg, fn, noSleep).waitForBatch("H");
  assert.deepEqual(result.errors.map((e) => e.id), ["a", "b"]);
});

test("Meta HTTP hatası okunur Türkçe/Meta mesajıyla fırlatılır, jeton sızmaz", async () => {
  const { fn } = fakeFetch(() => ({ status: 400, body: { error: { message: "Invalid OAuth access token.", code: 190 } } }));
  await assert.rejects(new MetaCatalogClient(cfg, fn, noSleep).submitBatch([]), (err: unknown) => {
    assert.ok(err instanceof MetaApiError);
    assert.equal(err.code, 190);
    assert.equal(err.status, 400);
    assert.ok(!err.message.includes("SECRET"));
    return true;
  });
});

test("ağ hatası MetaApiError olur; zaman aşımında net mesaj verilir", async () => {
  const failing = (async () => {
    throw new Error("ECONNRESET");
  }) as typeof fetch;
  await assert.rejects(new MetaCatalogClient(cfg, failing, noSleep).submitBatch([]), MetaApiError);

  const { fn } = fakeFetch(() => ({ body: { data: [{ status: "in_progress" }] } }));
  await assert.rejects(new MetaCatalogClient(cfg, fn, noSleep).waitForBatch("H", 3), /zamanında bitirmedi/);
});
