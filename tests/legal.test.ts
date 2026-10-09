import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPolicySections, humanDays } from "../shared/legal";
import { businessReady } from "../server/services/business";

const info = { legalName: "Örnek Gıda Ltd. Şti.", address: "Suadiye Mah. Örnek Cad. No:1 Kadıköy/İstanbul", email: "info@ornek.com", phone: "0216 000 00 00", verbis: "" };

test("süre metni: yıl, ay ve gün", () => {
  assert.equal(humanDays(730), "2 yıl");
  assert.equal(humanDays(365), "1 yıl");
  assert.equal(humanDays(90), "3 ay");
  assert.equal(humanDays(45), "45 gün");
  assert.equal(humanDays(7), "7 gün");
});

test("aydınlatma metni: veri sorumlusu, iletişim ve saklama süreleri ayarlardan gelir", () => {
  const sections = buildPolicySections(info, { messagesDays: 90, ordersDays: 730, ratingsDays: 365 });
  const text = sections.map((s) => `${s.title}\n${s.paragraphs.join("\n")}`).join("\n");
  assert.equal(sections.length, 6);
  assert.match(text, /Örnek Gıda Ltd\. Şti\./);
  assert.match(text, /Suadiye Mah\. Örnek Cad\./);
  assert.match(text, /info@ornek\.com/);
  assert.match(text, /Yazışma kayıtları 3 ay, sipariş kayıtları 2 yıl, değerlendirmeler 1 yıl/);
  assert.match(text, /KVKK md\. 11/);
  assert.ok(!text.includes("VERBIS"), "VERBIS boşsa metinde geçmemeli");
  assert.ok(!/\{|undefined/.test(text));
});

test("VERBIS numarası varsa metne eklenir", () => {
  const text = buildPolicySections({ ...info, verbis: "123456" }, { messagesDays: 90, ordersDays: 730, ratingsDays: 730 })[0].paragraphs.join(" ");
  assert.match(text, /VERBIS sicil no: 123456/);
});

test("yayın koşulu: ünvan, adres, e-posta ve telefon dolu olmalı (VERBIS isteğe bağlı)", () => {
  assert.equal(businessReady(info), true);
  assert.equal(businessReady({ ...info, legalName: "  " }), false);
  assert.equal(businessReady({ ...info, address: "" }), false);
  assert.equal(businessReady({ ...info, email: "" }), false);
  assert.equal(businessReady({ ...info, phone: "" }), false);
});
