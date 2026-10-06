import assert from "node:assert/strict";
import { test } from "node:test";
import { metaSignature, sameSecret, verifyMetaSignature } from "../server/lib/meta-signature";
import { CloudApiError, WhatsappCloudClient, extractCloudEvents, parseCloudOrder } from "../server/services/whatsapp-cloud";

const secret = "uygulama-sirri";

test("Meta imzası: sha256=<hex>, doğru kabul, bozuk/eksik/yanlış anahtar red", () => {
  const body = Buffer.from('{"object":"whatsapp_business_account","x":"İ ş ğ"}');
  const sig = metaSignature(body, secret);
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
  assert.equal(verifyMetaSignature(body, secret, sig), true);
  assert.equal(verifyMetaSignature(body, secret, sig.toUpperCase().replace("SHA256=", "sha256=")), true);
  assert.equal(verifyMetaSignature(body, "baska", sig), false);
  assert.equal(verifyMetaSignature(Buffer.from(body.toString() + " "), secret, sig), false);
  assert.equal(verifyMetaSignature(body, secret, undefined), false);
  assert.equal(verifyMetaSignature(body, secret, "sha256=abc"), false);
});

test("doğrulama anahtarı karşılaştırması", () => {
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abd", "abc"), false);
  assert.equal(sameSecret(undefined, "abc"), false);
  assert.equal(sameSecret("abcd", "abc"), false);
});

const order = {
  type: "order",
  from: "905551112233",
  id: "wamid.ORDER1",
  order: {
    catalog_id: "1868568421015157",
    text: "Acısız olsun",
    product_items: [
      { product_retailer_id: "tandir-tabagi-100-g", quantity: 2, item_price: 999, currency: "TRY" },
      { product_retailer_id: "ayran-30-cl", quantity: 1, item_price: 110.5, currency: "TRY" },
    ],
  },
};

test("sipariş: ürün kodları, adetler, kuruş cinsinden fiyatlar ve toplam", () => {
  const o = parseCloudOrder(order)!;
  assert.equal(o.catalogId, "1868568421015157");
  assert.equal(o.note, "Acısız olsun");
  assert.deepEqual(o.items, [
    { retailerId: "tandir-tabagi-100-g", quantity: 2, unitKurus: 99900, currency: "TRY" },
    { retailerId: "ayran-30-cl", quantity: 1, unitKurus: 11050, currency: "TRY" },
  ]);
  assert.equal(o.totalKurus, 2 * 99900 + 11050);
});

test("sipariş: sipariş olmayan mesaj ya da bozuk kalem null döner", () => {
  assert.equal(parseCloudOrder({ type: "text", text: { body: "x" } }), null);
  assert.equal(parseCloudOrder(null), null);
  assert.equal(parseCloudOrder({ type: "order", order: {} }), null);
  assert.equal(parseCloudOrder({ type: "order", order: { product_items: [{ product_retailer_id: "a", quantity: 0, item_price: 1 }] } }), null);
  assert.equal(parseCloudOrder({ type: "order", order: { product_items: [{ quantity: 1, item_price: 1 }] } }), null);
});

const webhook = (value: Record<string, unknown>, field = "messages") => ({ object: "whatsapp_business_account", entry: [{ id: "WABA1", changes: [{ field, value }] }] });
const meta = { display_phone_number: "15556479578", phone_number_id: "1408635558995998" };

test("webhook ayrıştırma: her mesaj ve her durum ayrı olay, oturum cloud:<numara kimliği>", () => {
  const evs = extractCloudEvents(
    webhook({
      messaging_product: "whatsapp",
      metadata: meta,
      contacts: [{ profile: { name: "Ali" }, wa_id: "905551112233" }],
      messages: [order, { id: "wamid.T1", type: "text", text: { body: "merhaba" } }],
      statuses: [{ id: "wamid.S1", status: "delivered" }],
    }),
  );
  assert.equal(evs.length, 3);
  assert.deepEqual(
    evs.map((e) => [e.event, e.messageType, e.session]),
    [
      ["cloud.message", "order", "cloud:1408635558995998"],
      ["cloud.message", "text", "cloud:1408635558995998"],
      ["cloud.status", "status:delivered", "cloud:1408635558995998"],
    ],
  );
  assert.deepEqual(evs.map((e) => e.requestId), ["cloud:msg:wamid.ORDER1", "cloud:msg:wamid.T1", "cloud:st:wamid.S1:delivered"]);
  const stored = JSON.parse(evs[0].body);
  assert.equal(stored.message.order.product_items.length, 2);
  assert.equal(stored.contacts[0].profile.name, "Ali");
});

test("webhook ayrıştırma: başka alanlar tek olay olur, yabancı gövde boş döner", () => {
  const evs = extractCloudEvents(webhook({ metadata: meta, event: "VERIFIED_ACCOUNT" }, "account_update"));
  assert.deepEqual(evs.map((e) => [e.event, e.messageType, e.requestId]), [["cloud.account_update", null, null]]);
  assert.deepEqual(extractCloudEvents({ object: "page", entry: [] }), []);
  assert.deepEqual(extractCloudEvents(null), []);
  assert.deepEqual(extractCloudEvents({ object: "whatsapp_business_account", entry: "x" }), []);
});

const cfg = { appSecret: "s", verifyToken: "v", token: "SECRET-TOKEN", version: "v23.0", baseUrl: "https://graph.example.test" };
function fake(handler: (url: URL, init: RequestInit) => { status?: number; body: unknown }) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}

test("mesaj gönderme: doğru adres, gövde, jeton yalnızca başlıkta", async () => {
  const { fn, calls } = fake(() => ({ body: { messages: [{ id: "wamid.OUT1" }] } }));
  const id = await new WhatsappCloudClient(cfg, fn).sendText("1408635558995998", "905551112233", "Siparişiniz alındı");
  assert.equal(id, "wamid.OUT1");
  assert.equal(calls[0].url.href, "https://graph.example.test/v23.0/1408635558995998/messages");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "905551112233",
    type: "text",
    text: { preview_url: false, body: "Siparişiniz alındı" },
  });
  assert.ok(!calls[0].url.href.includes("SECRET"));
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer SECRET-TOKEN");
});

test("Meta hatası okunur mesajla fırlatılır, jetonsuz istemci açık hata verir", async () => {
  const { fn } = fake(() => ({ status: 400, body: { error: { message: "Recipient phone number not in allowed list", code: 131030 } } }));
  await assert.rejects(new WhatsappCloudClient(cfg, fn).sendText("1", "90555", "x"), (err: unknown) => {
    assert.ok(err instanceof CloudApiError);
    assert.equal(err.code, 131030);
    assert.ok(!err.message.includes("SECRET"));
    return true;
  });
  await assert.rejects(new WhatsappCloudClient({ ...cfg, token: null }, fn).phoneInfo("1"), /WHATSAPP_CLOUD_TOKEN/);
});

test("numara bilgisi alanları okunur", async () => {
  const { fn, calls } = fake(() => ({ body: { display_phone_number: "+1 555 647 9578", verified_name: "Test Number", quality_rating: "GREEN", platform_type: "CLOUD_API" } }));
  const info = await new WhatsappCloudClient(cfg, fn).phoneInfo("1408635558995998");
  assert.deepEqual(info, { displayPhoneNumber: "+1 555 647 9578", verifiedName: "Test Number", qualityRating: "GREEN", platformType: "CLOUD_API" });
  assert.ok(calls[0].url.search.includes("fields=display_phone_number"));
});
