import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSpec, type MenuSpec } from "../server/services/menu-sync";

const base = (): MenuSpec => ({
  optionGroups: [{ key: "E", name: "Ekstra Malzeme", required: false, maxSelect: 5, choices: [{ name: "Domates", priceKurus: 4500 }] }],
  categories: [{ name: "Pideler", products: [{ source: "Bahçeden", name: "Bahçeden", variants: [{ label: "1 Porsiyon", priceKurus: 63250 }, { label: "1,5 Porsiyon", priceKurus: 94900 }], optionGroups: ["E"] }] }],
});

test("menü eşitleme: geçerli menü kabul edilir", () => {
  assert.equal(validateSpec(base()), null);
});

test("menü eşitleme: hatalı menüler açık mesajla reddedilir", () => {
  const unknownGroup = base();
  unknownGroup.categories[0].products[0].optionGroups = ["YOK"];
  assert.match(validateSpec(unknownGroup) ?? "", /bilinmeyen seçenek grubu/);

  const dup = base();
  dup.categories.push({ name: "Diğer", products: [dup.categories[0].products[0]] });
  assert.match(validateSpec(dup) ?? "", /iki kez/);

  const noLabel = base();
  noLabel.categories[0].products[0].variants[1].label = null;
  assert.match(validateSpec(noLabel) ?? "", /porsiyonun adı/);

  const zero = base();
  zero.categories[0].products[0].variants[0].priceKurus = 0;
  assert.match(validateSpec(zero) ?? "", /fiyat geçersiz/);

  const tooMany = base();
  tooMany.optionGroups[0].maxSelect = 10;
  assert.match(validateSpec(tooMany) ?? "", /1-9/);

  const longChoice = base();
  longChoice.optionGroups[0].choices[0].name = "x".repeat(25);
  assert.match(validateSpec(longChoice) ?? "", /24 karakter/);
});
