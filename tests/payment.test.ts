import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PAYMENT_TYPES, priceWithDiscount } from "../server/services/payment";
import { DEFAULT_TEMPLATES, renderTemplate } from "../server/services/order-messages";

test("indirim liste fiyatı toplamı üzerinden, kuruşa yuvarlanarak", () => {
  assert.deepEqual(priceWithDiscount(681000, 15), { discountKurus: 102150, payableKurus: 578850 });
  assert.deepEqual(priceWithDiscount(22000, 0), { discountKurus: 0, payableKurus: 22000 });
  assert.deepEqual(priceWithDiscount(99900, 15), { discountKurus: 14985, payableKurus: 84915 });
  // 1 kuruşluk yuvarlama: 333 kuruş %15 = 49,95 -> 50
  assert.deepEqual(priceWithDiscount(333, 15), { discountKurus: 50, payableKurus: 283 });
});

test("varsayılan ödeme şekilleri: nakit ve kart %15, yemek kartları indirimsiz, açık sayısı liste sınırını aşmaz", () => {
  const byName = Object.fromEntries(DEFAULT_PAYMENT_TYPES.map((p) => [p.name, p]));
  assert.equal(byName["Nakit"].discountPercent, 15);
  assert.equal(byName["Kapıda kredi kartı"].discountPercent, 15);
  assert.equal(byName["Edenred"].discountPercent, 0);
  assert.ok(DEFAULT_PAYMENT_TYPES.filter((p) => p.enabled).length <= 10);
  assert.ok(DEFAULT_PAYMENT_TYPES.every((p) => p.name.length <= 24), "WhatsApp liste başlığı 24 karakter");
});

test("onay mesajı şablonu tüm tutarları ve adresi doldurur", () => {
  const text = renderTemplate(DEFAULT_TEMPLATES.CONFIRMED, { ad: "Ali", no: 7, toplam: "1.000,00 TL", indirim: "-150,00 TL (%15)", tutar: "850,00 TL", odeme: "Nakit", adres: "Moda Mah. No:5" });
  assert.match(text, /No: 7/);
  assert.match(text, /Ödeme: Nakit/);
  assert.match(text, /Ödenecek tutar: 850,00 TL/);
  assert.match(text, /Adres: Moda Mah\. No:5/);
  assert.ok(!text.includes("{"), "doldurulmamış yer tutucu kalmamalı");
});

test("adres onayı şablonu satır sonlarını korur", () => {
  const text = renderTemplate(DEFAULT_TEMPLATES.CONFIRM_ADDRESS, { adres: "Moda Mah. No:5" });
  assert.equal(text, "Kayıtlı adresiniz:\nModa Mah. No:5\n\nSiparişi bu adrese gönderelim mi?");
});
