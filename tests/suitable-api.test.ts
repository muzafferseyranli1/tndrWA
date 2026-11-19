import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { apiPayment, apiPhone, menuToSnapshot, SuitableApiError, verifySuitableSignature } from "../server/services/suitable-api";
import { loadEnv } from "../server/lib/env";

test("API ödeme yöntemi: nakit, kart, yemek kartı sağlayıcıları", () => {
  assert.deepEqual(apiPayment("Nakit").payment, { method: "cash" });
  assert.deepEqual(apiPayment("Kapıda kredi kartı").payment, { method: "card_on_delivery" });
  assert.deepEqual(apiPayment("Yemek çeki (Multinet)").payment, { method: "meal_card", provider: "multinet" });
  assert.deepEqual(apiPayment("Sodexo yemek kartı").payment, { method: "meal_card", provider: "pluxee" });
  assert.deepEqual(apiPayment("Yemek çeki").payment, { method: "meal_card" });
  const other = apiPayment("Havale");
  assert.equal(other.payment.method, "card_on_delivery");
  assert.match(other.warning ?? "", /Havale/);
});

test("API telefon biçimi: +90 ile, geçersiz numara null", () => {
  assert.equal(apiPhone("905551112233"), "+905551112233");
  assert.equal(apiPhone("+905551112233"), "+905551112233");
  assert.equal(apiPhone("12345"), null);
  assert.equal(apiPhone(null), null);
});

test("API menüsü POS görüntüsüne çevrilir: pasif/stoksuz ürün pasif, sınırsız seçim 99, kimlikler korunur", () => {
  const snap = menuToSnapshot(
    {
      store: { id: "S1", name: "Suadiye | Yerinde Pide" },
      categories: [
        {
          id: "c1",
          name: "Pideler",
          products: [
            { id: "p1", name: "Kavurma", active: true, inStock: true, variants: [{ id: "v1", name: "1 Pors.", price: 863 }, { id: "v2", name: "1,5 Pors.", price: 1294.5 }], optionGroups: [{ id: "g1", name: "Yumurta", min: 0, max: null, items: [{ id: "o1", name: "1 Yumurta", price: 30 }] }] },
            { id: "p2", name: "Ayran", active: true, inStock: false, price: 20 },
            { id: "p3", name: "Eski", active: false, price: 10 },
          ],
        },
        { id: "c2", name: "Kapalı kategori", active: false, products: [{ id: "p4", name: "X", active: true, price: 5 }] },
      ],
    },
    "S1",
  );
  assert.equal(snap.cafeId, "S1");
  assert.equal(snap.cafeName, "Suadiye | Yerinde Pide");
  const byName = Object.fromEntries(snap.products.map((p) => [p.name, p]));
  assert.equal(byName.Kavurma.active, true);
  assert.deepEqual(byName.Kavurma.variants.map((v) => v.id), ["v1", "v2"]);
  assert.equal(byName.Kavurma.options[0].max, 99);
  assert.equal(byName.Kavurma.options[0].items[0].id, "o1");
  assert.equal(byName.Ayran.active, false);
  assert.equal(byName.Eski.active, false);
  assert.equal(byName.X.active, false);
  assert.equal(byName.Ayran.price, 20);
});

test("Webhook imzası: doğru imza, yanlış imza, eski zaman damgası", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ event: "order.status", status: "on_the_way" });
  const now = 1_790_000_000;
  const sign = (ts: string) => `sha256=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
  assert.equal(verifySuitableSignature(secret, String(now), body, sign(String(now)), now), "ok");
  assert.equal(verifySuitableSignature(secret, String(now), body, "sha256=00", now), "bad_signature");
  assert.equal(verifySuitableSignature(secret, String(now), body + " ", sign(String(now)), now), "bad_signature");
  assert.equal(verifySuitableSignature(secret, undefined, body, sign(String(now)), now), "bad_signature");
  assert.equal(verifySuitableSignature(secret, String(now - 400), body, sign(String(now - 400)), now), "stale");
  assert.equal(verifySuitableSignature("baska", String(now), body, sign(String(now)), now), "bad_signature");
});

test("Hata sınıflaması: ağ/5xx/429/store_closed yeniden denenir, diğer 4xx kalıcıdır", () => {
  assert.equal(new SuitableApiError(0, "network", "x").retryable, true);
  assert.equal(new SuitableApiError(500, "internal", "x").retryable, true);
  assert.equal(new SuitableApiError(429, "rate_limited", "x").retryable, true);
  assert.equal(new SuitableApiError(423, "store_closed", "x").retryable, true);
  for (const [s, c] of [[400, "validation"], [401, "invalid_key"], [403, "forbidden_store"], [422, "product_unavailable"], [422, "option_invalid"], [409, "price_mismatch"]] as const) assert.equal(new SuitableApiError(s, c, "x").retryable, false, c);
});

test("Suitable ortam ayarı: taban adres ve anahtar birlikte, mağaza kimlikleri küçük harf", () => {
  const base = { DATABASE_URL: "file:./test.db", SESSION_SECRET: "s".repeat(40), ADMIN_USERNAME: "admin", ADMIN_PASSWORD_HASH: "scrypt:16384:8:1:salt:hash" };
  assert.equal(loadEnv({ ...base }).suitable, null);
  assert.throws(() => loadEnv({ ...base, SUITABLE_API_BASE: "https://api.example.com/v1" }), /Suitable API ayarları yarım/);
  const ok = loadEnv({ ...base, SUITABLE_API_BASE: "https://api.example.com/v1/", SUITABLE_API_KEY: "swk_a_b", SUITABLE_WEBHOOK_SECRET: "whsec_x", SUITABLE_STORE_PIDE: "IgQb123", SUITABLE_STORE_TANDIR: "ha2Ik" });
  assert.equal(ok.suitable?.baseUrl, "https://api.example.com/v1");
  assert.equal(ok.suitable?.webhookSecret, "whsec_x");
  assert.deepEqual(ok.suitable?.stores, { pide: "IgQb123", tandir: "ha2Ik" });
});
