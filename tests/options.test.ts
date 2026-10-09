import assert from "node:assert/strict";
import { test } from "node:test";
import { describeOptions } from "../server/services/option-format";

test("seçim özeti: ücretsizler adıyla, ücretliler fiyatıyla; 'Hiçbiri' (boş ad) gösterilmez", () => {
  assert.deepEqual(describeOptions([{ choiceName: "Acılı", extraKurus: 0 }]), ["Acılı"]);
  assert.deepEqual(describeOptions([{ choiceName: "Büyük boy", extraKurus: 2000 }, { choiceName: "", extraKurus: 0 }]), ["Büyük boy (+20,00 TL)"]);
  assert.deepEqual(describeOptions([]), []);
});
