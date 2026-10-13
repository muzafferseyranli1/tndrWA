import assert from "node:assert/strict";
import { test } from "node:test";
import { computeDiscount, etTandirCampaignApplies, type DiscountItem } from "../shared/campaigns";

// 2026-10-13 Salı, 2026-10-14 Çarşamba, 2026-10-15 Perşembe (İstanbul)
const at = (day: string, hhmm: string) => new Date(`2026-10-${day}T${hhmm}:00+03:00`);
const et = (unit: number, qty = 1): DiscountItem => ({ unitKurus: unit * 100, extraKurus: 0, quantity: qty, categoryName: "Et Tandırlar" });
const other = (unit: number, qty = 1): DiscountItem => ({ unitKurus: unit * 100, extraKurus: 0, quantity: qty, categoryName: "İçecekler" });
const run = (over: Partial<Parameters<typeof computeDiscount>[0]>) => computeDiscount({ brandCode: "tandir", createdAt: at("15", "12:00"), paymentPercent: 15, items: [et(800), other(300)], ...over });

test("Perşembe 18:00 öncesi, 1.000 TL ve üstü, nakit/kart: Et Tandırlar %50, diğerleri %15", () => {
  const r = run({});
  assert.equal(r.discountKurus, 40000 + 4500); // 800*%50 + 300*%15
  assert.match(r.note, /Et Tandırlar %50, diğer ürünler %15/);
});

test("deneme için Salı da geçerli, Çarşamba geçerli değil", () => {
  assert.equal(run({ createdAt: at("13", "12:00") }).discountKurus, 44500);
  const wed = run({ createdAt: at("14", "12:00") });
  assert.equal(wed.discountKurus, 16500); // 1100 * %15
  assert.equal(wed.note, "");
});

test("Perşembe 18:00 ve sonrası yalnızca %15", () => {
  assert.equal(run({ createdAt: at("15", "17:59") }).discountKurus, 44500);
  const r = run({ createdAt: at("15", "18:00") });
  assert.equal(r.discountKurus, 16500);
  assert.equal(r.note, "");
});

test("1.000 TL altında yalnızca %15, tam 1.000 TL kampanyaya girer", () => {
  assert.equal(run({ items: [et(600), other(300)] }).discountKurus, 13500);
  assert.equal(run({ items: [et(700), other(300)] }).discountKurus, 35000 + 4500);
});

test("yemek kartı (indirimsiz ödeme): kampanya da uygulanmaz", () => {
  const r = run({ paymentPercent: 0 });
  assert.deepEqual(r, { discountKurus: 0, note: "" });
});

test("Pide markasında uygulanmaz", () => {
  const r = run({ brandCode: "pide" });
  assert.equal(r.discountKurus, 16500);
  assert.equal(r.note, "");
});

test("sepette Et Tandırlar ürünü yoksa uygulanmaz", () => {
  assert.equal(run({ items: [other(600), other(500)] }).note, "");
  assert.equal(etTandirCampaignApplies({ brandCode: "tandir", createdAt: at("15", "12:00"), items: [other(1200)] }), false);
});

test("adet ve ekstra ücret tutara ve indirime dahil", () => {
  const r = run({ items: [{ unitKurus: 40000, extraKurus: 1000, quantity: 2, categoryName: "Et Tandırlar" }, other(200)] });
  assert.equal(r.discountKurus, 41000 + 3000); // (400+10)*2 %50 + 200 %15
});

test("kategori adında büyük/küçük harf ve boşluk farkı önemsiz", () => {
  assert.equal(run({ items: [{ ...et(900), categoryName: " et tandırlar " }, other(200)] }).discountKurus, 45000 + 3000);
});
