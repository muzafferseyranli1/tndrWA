import assert from "node:assert/strict";
import { test } from "node:test";
import { availabilityOf, nextResetAt } from "../shared/availability";

const now = new Date("2026-10-06T10:00:00Z"); // Türkiye 13:00

test("aktif ürün stokta, pasif ürün gizli", () => {
  assert.equal(availabilityOf({ status: "ACTIVE", soldOutUntil: null }, now), "IN_STOCK");
  assert.equal(availabilityOf({ status: "PASSIVE", soldOutUntil: null }, now), "HIDDEN");
});

test("tükendi işareti süresi dolana kadar stokta yok, sonra otomatik stokta", () => {
  const until = new Date("2026-10-07T02:00:00Z");
  assert.equal(availabilityOf({ status: "ACTIVE", soldOutUntil: until }, now), "OUT_OF_STOCK");
  assert.equal(availabilityOf({ status: "ACTIVE", soldOutUntil: until }, new Date("2026-10-07T02:00:00Z")), "IN_STOCK");
  assert.equal(availabilityOf({ status: "ACTIVE", soldOutUntil: until }, new Date("2026-10-07T03:00:00Z")), "IN_STOCK");
});

test("pasif ürün tükendi işaretli olsa da gizli kalır", () => {
  const until = new Date("2026-10-07T02:00:00Z");
  assert.equal(availabilityOf({ status: "PASSIVE", soldOutUntil: until }, now), "HIDDEN");
});

test("sıfırlama: öğleden sonra işaretlenirse ertesi sabah 05:00 (Türkiye)", () => {
  assert.equal(nextResetAt(now, 5).toISOString(), "2026-10-07T02:00:00.000Z");
});

test("sıfırlama: gece yarısından sonra ama 05:00 öncesi işaretlenirse aynı sabah", () => {
  // Türkiye 01:30 -> 05:00 aynı gün
  assert.equal(nextResetAt(new Date("2026-10-06T22:30:00Z"), 5).toISOString(), "2026-10-07T02:00:00.000Z");
});

test("sıfırlama: tam 05:00'te işaretlenirse bir sonraki gün", () => {
  assert.equal(nextResetAt(new Date("2026-10-07T02:00:00Z"), 5).toISOString(), "2026-10-08T02:00:00.000Z");
});

test("sıfırlama saati ayarlanabilir", () => {
  assert.equal(nextResetAt(now, 6).toISOString(), "2026-10-07T03:00:00.000Z");
});
