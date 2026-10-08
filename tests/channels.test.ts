import assert from "node:assert/strict";
import { test } from "node:test";
import { channelHref, normalizePhone, normalizeUrl, validateChannelValue } from "../shared/channels";

test("telefon numarası uluslararası biçime çevrilir", () => {
  assert.equal(normalizePhone("0533 123 45 67"), "905331234567");
  assert.equal(normalizePhone("533 123 45 67"), "905331234567");
  assert.equal(normalizePhone("+90 (533) 123-45-67"), "905331234567");
  assert.equal(normalizePhone("0090 533 123 45 67"), "905331234567");
  assert.equal(normalizePhone("0212 123 45 67"), "902121234567");
  assert.equal(normalizePhone("+1 555 647 9578"), "15556479578");
});

test("geçersiz telefon reddedilir", () => {
  assert.equal(normalizePhone("123"), null);
  assert.equal(normalizePhone("abc"), null);
  assert.equal(normalizePhone("0533 123 45"), null);
  assert.equal(normalizePhone("+90 533 123 45 678"), null);
});

test("yalnızca https bağlantı kabul edilir", () => {
  assert.equal(normalizeUrl("https://tgoyemek.com/restoranlar/479288"), "https://tgoyemek.com/restoranlar/479288");
  assert.equal(normalizeUrl("http://example.com"), null);
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("https://localhost"), null);
  assert.equal(normalizeUrl("abc"), null);
});

test("değer doğrulama: türüne göre, boş değer geçerli", () => {
  assert.deepEqual(validateChannelValue("CALL", ""), { ok: true, value: "" });
  assert.deepEqual(validateChannelValue("CALL", "0212 123 45 67"), { ok: true, value: "902121234567" });
  assert.equal(validateChannelValue("CALL", "12").ok, false);
  assert.equal(validateChannelValue("YEMEKSEPETI", "yemeksepeti.com/x").ok, false);
  assert.equal(validateChannelValue("YEMEKSEPETI", "https://www.yemeksepeti.com/restaurant/ithr/x").ok, true);
  assert.deepEqual(validateChannelValue("MAPS", "Atatürk Cd. No:1, Ataşehir"), { ok: true, value: "Atatürk Cd. No:1, Ataşehir" });
  assert.equal(validateChannelValue("MAPS", "javascript:alert(1)").ok, false);
  assert.equal(validateChannelValue("MAPS", "https://maps.app.goo.gl/abc").ok, true);
});

test("buton adresleri: tel, wa.me, harita yönlendirme, diğerleri https", () => {
  assert.equal(channelHref("CALL", "905331234567"), "tel:+905331234567");
  assert.equal(channelHref("WHATSAPP", "905331234567", "Selam"), "https://wa.me/905331234567?text=Selam");
  assert.equal(channelHref("MAPS", "Atatürk Cd. No:1"), "https://www.google.com/maps/dir/?api=1&destination=Atat%C3%BCrk%20Cd.%20No%3A1");
  assert.equal(channelHref("MAPS", "https://maps.app.goo.gl/abc"), "https://maps.app.goo.gl/abc");
  assert.equal(channelHref("GETIR", "https://getir.com/yemek/x"), "https://getir.com/yemek/x");
  assert.equal(channelHref("GETIR", "http://getir.com"), null);
  assert.equal(channelHref("CALL", ""), null);
  assert.equal(channelHref("CALL", "abc"), null);
});
