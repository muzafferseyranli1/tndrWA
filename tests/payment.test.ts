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

import { addressKey } from "../server/services/order-flow";

test("adres anahtarı: büyük/küçük harf ve boşluk farkı aynı adresi verir", () => {
  assert.equal(addressKey("  Bağdat   Cad. No:100  Kadıköy "), addressKey("bağdat cad. no:100 kadıköy"));
  assert.equal(addressKey("IŞIK Sok. No:3"), "ışık sok. no:3");
  assert.notEqual(addressKey("Bağdat Cad. No:100"), addressKey("Bağdat Cad. No:101"));
});

import { LOW_SCORE_BELOW, isLow, newRatingToken } from "../server/services/ratings";

test("düşük puan: herhangi bir soru 4'ün altındaysa", () => {
  assert.equal(LOW_SCORE_BELOW, 4);
  assert.equal(isLow(5, 5, 5), false);
  assert.equal(isLow(5, 5, 4), false);
  assert.equal(isLow(5, 3, 5), true);
  assert.equal(isLow(1, 1, 1), true);
});

test("değerlendirme anahtarı: tahmin edilemez, URL'ye uygun, tekrar etmez", () => {
  const a = newRatingToken();
  assert.match(a, /^[A-Za-z0-9_-]{12}$/);
  assert.notEqual(a, newRatingToken());
});

test("şablon: değeri boş 'Etiket: {değişken}' satırı gösterilmez; diğer satırlar ve etiket-yalnız satırlar korunur", () => {
  assert.equal(renderTemplate("Toplam: {toplam}\nAdres: {adres}", { toplam: "1,00 TL", adres: "" }), "Toplam: 1,00 TL");
  assert.equal(renderTemplate("Toplam: {toplam}\nAdres: {adres}", { toplam: "1,00 TL", adres: "Moda" }), "Toplam: 1,00 TL\nAdres: Moda");
  assert.equal(renderTemplate("Ödeme: {odeme}\nToplam: {toplam}", { odeme: "", toplam: "5 TL" }), "Toplam: 5 TL");
  // "Kayıtlı adresiniz:" tek başına etiket satırıdır ama değişken içermez: korunur
  assert.equal(renderTemplate(DEFAULT_TEMPLATES.CONFIRM_ADDRESS, { adres: "Moda Mah. No:5" }), "Kayıtlı adresiniz:\nModa Mah. No:5\n\nSiparişi bu adrese gönderelim mi?");
  // ad boşsa selamlama satırı atılmaz
  assert.equal(renderTemplate("Merhaba {ad}, hoş geldiniz", { ad: null }), "Merhaba, hoş geldiniz");
});
