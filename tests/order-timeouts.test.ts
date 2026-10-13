import assert from "node:assert/strict";
import { test } from "node:test";
import { REPLY_TIMEOUT_MS, timeoutAction } from "../server/services/order-timeouts";

const now = new Date("2026-10-13T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const base = { status: "NEW", stage: "AWAITING_PAYMENT", promptedAt: ago(1), reminderSentAt: null as Date | null };

test("varsayılan bekleme süresi 5 dakika", () => {
  assert.equal(REPLY_TIMEOUT_MS, 5 * 60_000);
});

test("5 dakikadan kısa sürede hiçbir şey yapılmaz", () => {
  assert.equal(timeoutAction({ ...base, promptedAt: ago(4.9) }, now), null);
});

test("5 dakika yanıt yoksa hatırlatma", () => {
  assert.equal(timeoutAction({ ...base, promptedAt: ago(5) }, now), "remind");
  assert.equal(timeoutAction({ ...base, stage: "AWAITING_ADDRESS", promptedAt: ago(7) }, now), "remind");
  assert.equal(timeoutAction({ ...base, stage: "AWAITING_OPTIONS", promptedAt: ago(7) }, now), "remind");
});

test("hatırlatmadan 5 dakika sonra iptal, öncesinde bekle", () => {
  assert.equal(timeoutAction({ ...base, promptedAt: ago(9), reminderSentAt: ago(4) }, now), null);
  assert.equal(timeoutAction({ ...base, promptedAt: ago(10), reminderSentAt: ago(5) }, now), "cancel");
});

test("hazır, iptal edilmiş ya da hiç soru gitmemiş siparişe dokunulmaz", () => {
  assert.equal(timeoutAction({ ...base, stage: "READY", promptedAt: ago(60) }, now), null);
  assert.equal(timeoutAction({ ...base, status: "CANCELLED", promptedAt: ago(60) }, now), null);
  assert.equal(timeoutAction({ ...base, promptedAt: null }, now), null);
});
