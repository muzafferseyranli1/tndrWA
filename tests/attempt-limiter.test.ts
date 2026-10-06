import assert from "node:assert/strict";
import { test } from "node:test";
import { AttemptLimiter } from "../server/lib/attempt-limiter";

test("limit dolunca bloklar, pencere geçince açılır", () => {
  let now = 0;
  const limiter = new AttemptLimiter(3, 1000, () => now);
  for (let i = 0; i < 3; i++) limiter.recordFailure("ip");
  assert.equal(limiter.isBlocked("ip"), true);
  now = 1001;
  assert.equal(limiter.isBlocked("ip"), false);
});

test("anahtarlar birbirinden bağımsızdır, reset temizler", () => {
  const limiter = new AttemptLimiter(2, 1000, () => 0);
  limiter.recordFailure("a");
  limiter.recordFailure("a");
  assert.equal(limiter.isBlocked("a"), true);
  assert.equal(limiter.isBlocked("b"), false);
  limiter.reset("a");
  assert.equal(limiter.isBlocked("a"), false);
});
