import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "../shared/slug";

test("Türkçe karakterler ve noktalama sadeleşir", () => {
  assert.equal(slugify("Tandır Tabağı (100 g)"), "tandir-tabagi-100-g");
  assert.equal(slugify("Tandır & Cheese Pide Sandviç"), "tandir-cheese-pide-sandvic");
  assert.equal(slugify("İçecek ŞALGAM Suyu"), "icecek-salgam-suyu");
  assert.equal(slugify("Ev Yapımı Limonata"), "ev-yapimi-limonata");
  assert.equal(slugify("Coca-Cola Zero Sugar (33 cl)"), "coca-cola-zero-sugar-33-cl");
});

test("tamamen geçersiz girdi boş döner", () => {
  assert.equal(slugify("!!!"), "");
  assert.equal(slugify("   "), "");
});
