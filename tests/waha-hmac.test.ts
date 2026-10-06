import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyWahaSignature, wahaSignature } from "../server/lib/waha-hmac";

const secret = "gizli-anahtar";
const body = Buffer.from(JSON.stringify({ event: "message", session: "tandir", payload: { body: "Merhaba İ ş ğ" } }));

test("doğru imza kabul edilir (HMAC-SHA512, hex)", () => {
  const sig = wahaSignature(body, secret);
  assert.equal(sig.length, 128);
  assert.equal(verifyWahaSignature(body, secret, sig), true);
  assert.equal(verifyWahaSignature(body, secret, sig.toUpperCase()), true);
});

test("yanlış anahtar, değişmiş gövde, eksik ya da bozuk başlık reddedilir", () => {
  const sig = wahaSignature(body, secret);
  assert.equal(verifyWahaSignature(body, "baska-anahtar", sig), false);
  assert.equal(verifyWahaSignature(Buffer.from(body.toString() + " "), secret, sig), false);
  assert.equal(verifyWahaSignature(body, secret, undefined), false);
  assert.equal(verifyWahaSignature(body, secret, ""), false);
  assert.equal(verifyWahaSignature(body, secret, "abc"), false);
});

test("bilinen test vektörü: HMAC-SHA512('key', 'The quick brown fox jumps over the lazy dog')", () => {
  const sig = wahaSignature(Buffer.from("The quick brown fox jumps over the lazy dog"), "key");
  assert.equal(sig, "b42af09057bac1e2d41708e48a902e09b5ff7f12ab428a4fe86653c73dd248fb82f948a549f7b791a5b41915ee4d1ec3935357e4e2317250d0372afa2ebeeb3a");
});
