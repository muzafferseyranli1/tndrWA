import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTRY, metaPrice, parsePriceToKurus, percentOf, portionPrice } from "../shared/money";

test("Türkçe ve düz fiyat girdileri kuruşa çevrilir", () => {
  const cases: [string | number, number][] = [
    ["949", 94900],
    ["1.099,00", 109900],
    ["1.099", 109900],
    ["806,65", 80665],
    ["949.50", 94950],
    ["1099.5", 109950],
    ["₺375", 37500],
    ["375 TL", 37500],
    [127.5, 12750],
  ];
  for (const [input, expected] of cases) assert.equal(parsePriceToKurus(input), expected, String(input));
});

test("geçersiz fiyatlar null döner", () => {
  for (const bad of ["", "abc", "-5", "12,345", "1,2,3", "9.99.9", Number.NaN, -1]) {
    assert.equal(parsePriceToKurus(bad as string), null, String(bad));
  }
});

test("TL biçimi binlik nokta ve virgülle", () => {
  assert.equal(formatTRY(109900), "1.099,00 TL");
  assert.equal(formatTRY(12750), "127,50 TL");
  assert.equal(formatTRY(5), "0,05 TL");
  assert.equal(formatTRY(123456789), "1.234.567,89 TL");
});

test("Meta fiyat biçimi", () => {
  assert.equal(metaPrice(109900), "1099.00 TRY");
  assert.equal(metaPrice(12750), "127.50 TRY");
  assert.equal(metaPrice(5), "0.05 TRY");
});

test("yüzde indirim kuruşa yuvarlanır (liste fiyatının %15'i)", () => {
  assert.equal(percentOf(94900, 15), 14235); // 949 TL -> 142,35 TL; net 806,65 TL
  assert.equal(94900 - percentOf(94900, 15), 80665);
  assert.equal(percentOf(105000, 15), 15750); // 1050 -> 892,50
  assert.equal(percentOf(333, 15), 50); // 49,95 -> 50
});

test("1,5 porsiyon: x1,5 ve tam liraya yuvarlama (Yerinde Pide listesindeki örnekler)", () => {
  assert.equal(portionPrice(63250, 1.5), 94900); // 948,75 -> 949
  assert.equal(portionPrice(65450, 1.5), 98200); // 981,75 -> 982
  assert.equal(portionPrice(74250, 1.5), 111400); // 1113,75 -> 1114
  assert.equal(portionPrice(86350, 1.5), 129500); // 1295,25 -> 1295
  assert.equal(portionPrice(86300, 1.5), 129500); // 1294,50 -> 1295 (yarım yukarı)
  assert.equal(portionPrice(41250, 1.5), 61900); // 618,75 -> 619
});
