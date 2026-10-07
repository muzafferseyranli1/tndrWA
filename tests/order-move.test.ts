import assert from "node:assert/strict";
import { test } from "node:test";
import { moveInOrder } from "../server/routes/products";

const rows = [
  { id: 1, groupKey: null },
  { id: 2, groupKey: "G" },
  { id: 3, groupKey: "G" },
  { id: 4, groupKey: null },
];

test("sıralama: porsiyonlu yemek tek birim olarak taşınır", () => {
  const m = moveInOrder(rows, 1, "down")!;
  assert.deepEqual(m.map((x) => [x.id, x.position]), [[2, 0], [3, 0], [1, 1], [4, 2]]);
  const up = moveInOrder(rows, 3, "up")!;
  assert.deepEqual(up.map((x) => [x.id, x.position]), [[2, 0], [3, 0], [1, 1], [4, 2]]);
});

test("sıralama: uçta taşıma yapılmaz, bilinmeyen kimlik null", () => {
  assert.equal(moveInOrder(rows, 1, "up"), null);
  assert.equal(moveInOrder(rows, 4, "down"), null);
  assert.equal(moveInOrder(rows, 99, "up"), null);
});
