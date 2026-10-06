import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "../server/lib/password";

test("doğru şifre doğrulanır", async () => {
  const hash = await hashPassword("dogru-sifre-123");
  assert.equal(await verifyPassword("dogru-sifre-123", hash), true);
});

test("yanlış şifre reddedilir", async () => {
  const hash = await hashPassword("dogru-sifre-123");
  assert.equal(await verifyPassword("yanlis-sifre-123", hash), false);
});

test("hash '$' içermez ve her seferinde farklıdır (rastgele tuz)", async () => {
  const a = await hashPassword("ayni-sifre-123");
  const b = await hashPassword("ayni-sifre-123");
  assert.ok(!a.includes("$"));
  assert.notEqual(a, b);
});

test("bozuk hash biçimi hata fırlatmadan reddedilir", async () => {
  assert.equal(await verifyPassword("x", "bozuk"), false);
  assert.equal(await verifyPassword("x", "scrypt:a:b:c:d:e"), false);
  assert.equal(await verifyPassword("x", "bcrypt:1:2:3:4:5"), false);
});
