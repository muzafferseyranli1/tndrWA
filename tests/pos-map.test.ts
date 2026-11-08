import assert from "node:assert/strict";
import { test } from "node:test";
import { findPosProduct, portionNorm, posNorm, posPayment, posSnapshotSchema, type PosProduct } from "../server/services/pos-map";
import { primaryPhone } from "../server/services/pos-bridge";

const prod = (name: string, variants: { name: string; price: number }[], extra: Partial<PosProduct> = {}): PosProduct => ({ id: name, name, category: "", sku: null, active: true, price: variants[0]?.price ?? 0, variants, options: [], ...extra });

test("POS eşleştirme: adlar ve porsiyon adları sadeleştirilir", () => {
  assert.equal(posNorm("Kavurma / Kaşar - Kapalı"), "kavurma kaşar kapalı");
  assert.equal(portionNorm("1 Porsiyon"), portionNorm("1P"));
  assert.equal(portionNorm("1,5 Porsiyon"), portionNorm("15P"));
  assert.equal(portionNorm("100 g"), portionNorm("100 gr"));
  assert.equal(portionNorm("1 Porsiyon"), portionNorm("1 Pors."));
  assert.equal(portionNorm("1,5 Porsiyon"), portionNorm("1,5 Pors."));
  assert.equal(portionNorm("1 Porsiyon"), portionNorm("1 pors"));
  assert.notEqual(portionNorm("1 Porsiyon"), portionNorm("1,5 Porsiyon"));
});

test("POS eşleştirme: ürün önce kasa adıyla (sourceKey), porsiyon adıyla bulunur", () => {
  const products = [prod("Kavurmalı - Kapalı", [{ name: "1P", price: 863 }, { name: "15P", price: 1294.5 }]), prod("Ayran 330 Ml", [{ name: "Standart", price: 29 }])];
  const a = findPosProduct(products, { name: "Kavurmalı Kapalı", sourceKey: "rms:Kavurmalı - Kapalı", variantLabel: "1,5 Porsiyon" });
  assert.ok(!("error" in a));
  assert.equal(a.product.name, "Kavurmalı - Kapalı");
  assert.equal(a.variant, "15P");
  // Tek porsiyonlu ürün: etiketsiz panel ürünü POS'un tek porsiyonuna gider
  const b = findPosProduct(products, { name: "Ayran 330 Ml", sourceKey: null, variantLabel: null });
  assert.ok(!("error" in b) && b.variant === "Standart");
  assert.deepEqual(findPosProduct(products, { name: "Yok Böyle", sourceKey: null, variantLabel: null }), { error: "noProduct" });
  const c = findPosProduct(products, { name: "Kavurmalı Kapalı", sourceKey: "rms:Kavurmalı - Kapalı", variantLabel: "Yarım" });
  assert.ok("error" in c && c.error === "noVariant");
  // Suitable adları: "1 Pors." / "1,5 Pors."; panelde porsiyonsuz ürün "1 Pors."a gider
  const pide = [prod("Dört Mevsim", [{ name: "1 Pors.", price: 300 }, { name: "Yarım", price: 200 }, { name: "1,5 Pors.", price: 450 }]), prod("Düğün Çorba", [{ name: "1 Pors.", price: 150 }, { name: "Az", price: 100 }])];
  const d = findPosProduct(pide, { name: "Dört Mevsim", sourceKey: null, variantLabel: "1,5 Porsiyon" });
  assert.ok(!("error" in d) && d.variant === "1,5 Pors.");
  const e = findPosProduct(pide, { name: "Düğün Çorba", sourceKey: null, variantLabel: null });
  assert.ok(!("error" in e) && e.variant === "1 Pors.");
});

test("POS eşleştirme: çok porsiyonlu üründe etiketsiz panel ürünü 'Standart' porsiyona gider; pasif kopya yerine aktif seçilir", () => {
  const products = [prod("Special", [{ name: "Küçük Boy", price: 140 }, { name: "Standart", price: 195 }]), prod("Lahmacun", [{ name: "Standart", price: 280 }], { active: false }), prod("Lahmacun", [{ name: "Standart", price: 280 }], { id: "aktif" })];
  const s = findPosProduct(products, { name: "Special", sourceKey: null, variantLabel: null });
  assert.ok(!("error" in s) && s.variant === "Standart");
  const l = findPosProduct(products, { name: "Lahmacun", sourceKey: null, variantLabel: null });
  assert.ok(!("error" in l) && l.product.id === "aktif");
});

test("POS ödeme düğmesi: panel ödeme şekli POS düğmesine çevrilir", () => {
  assert.deepEqual(posPayment("Nakit"), { label: "Nakit", button: "Nakit", sub: null });
  assert.equal(posPayment("Kapıda kredi kartı").button, "Kredi Kartı");
  assert.deepEqual(posPayment("Multinet"), { label: "Multinet", button: "Yemek Çeki", sub: "Multinet" });
  assert.equal(posPayment("Sodexo").sub, "Pluxee (Sodexo)");
  assert.equal(posPayment("Edenred").sub, "Edenred");
  assert.equal(posPayment("Havale").button, "Diğer");
});

test("POS müşterisi: cep numarası öncelikli, geçersizler atlanır", () => {
  assert.equal(primaryPhone(["0216 362 00 55", "+90 532 123 45 67"]), "905321234567");
  assert.equal(primaryPhone(["02163620055"]), "902163620055");
  assert.equal(primaryPhone(["abc", ""]), null);
});

test("POS menü verisi doğrulanır (eksik alanlar varsayılanla dolar, aşırı büyük reddedilir)", () => {
  const ok = posSnapshotSchema.safeParse({ cafeId: "rLZ", products: [{ id: "p1", name: "Special", options: [{ name: "Extra", min: 1, max: 3, items: [{ name: "Mantar", price: 30 }] }] }] });
  assert.ok(ok.success);
  assert.deepEqual(ok.data.products[0].variants, []);
  assert.equal(ok.data.products[0].active, true);
  assert.equal(posSnapshotSchema.safeParse({ cafeId: "", products: [] }).success, false);
  assert.equal(posSnapshotSchema.safeParse({ cafeId: "x", products: [{ id: "p", name: "" }] }).success, false);
});
