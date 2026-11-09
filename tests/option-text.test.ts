import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChoiceText } from "../server/services/options";

const ch = ["Domates", "Çarliston Biber", "Kaşar Peyniri", "Pastırma", "Zeytin", "Mantar", "Kıyma", "Sucuk", "Kavurma"].map((name) => ({ name }));
const names = (r: { matched: { name: string }[] }) => r.matched.map((c) => c.name);

test("yazıyla seçenek: numaralar", () => {
  assert.deepEqual(names(parseChoiceText("1 3 5", ch)), ["Domates", "Kaşar Peyniri", "Zeytin"]);
  assert.deepEqual(names(parseChoiceText("2,8", ch)), ["Çarliston Biber", "Sucuk"]);
});

test("yazıyla seçenek: adlar, ekler ve yazım hataları", () => {
  assert.deepEqual(names(parseChoiceText("kavurma mantar sucuk", ch)), ["Kavurma", "Mantar", "Sucuk"]);
  assert.deepEqual(names(parseChoiceText("Mantarlı, sucuklu ve kaşar olsun", ch)), ["Mantar", "Sucuk", "Kaşar Peyniri"]);
  assert.deepEqual(names(parseChoiceText("biber ve zeytin", ch)), ["Çarliston Biber", "Zeytin"]);
  assert.deepEqual(names(parseChoiceText("pastirma", ch)), ["Pastırma"]);
  assert.deepEqual(names(parseChoiceText("sucku kıymma", ch)), ["Sucuk", "Kıyma"]);
});

test("yazıyla seçenek: anlaşılamayan ve 'yok'", () => {
  const r = parseChoiceText("mantar ananas", ch);
  assert.deepEqual(names(r), ["Mantar"]);
  assert.deepEqual(r.unknown, ["ananas"]);
  assert.equal(parseChoiceText("Yok", ch).none, true);
  assert.equal(parseChoiceText("hiçbiri", ch).none, true);
});
