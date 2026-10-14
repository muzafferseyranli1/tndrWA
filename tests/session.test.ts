import assert from "node:assert/strict";
import { test } from "node:test";
import { SESSION_TTL_MS, createSessionToken, getCookie, sessionCookieHeader, shouldRenewSession, verifySessionToken } from "../server/lib/session";

const SECRET = "a".repeat(40);

test("geçerli oturum doğrulanır", () => {
  const token = createSessionToken(SECRET, "admin", 1000, 5000);
  assert.deepEqual(verifySessionToken(SECRET, token, 2000), { username: "admin", exp: 6000 });
});

test("süresi dolan oturum reddedilir", () => {
  const token = createSessionToken(SECRET, "admin", 1000, 5000);
  assert.equal(verifySessionToken(SECRET, token, 6000), null);
});

test("yanlış anahtarla imzalanmış oturum reddedilir", () => {
  const token = createSessionToken("b".repeat(40), "admin", 1000, 5000);
  assert.equal(verifySessionToken(SECRET, token, 2000), null);
});

test("içeriği değiştirilmiş oturum reddedilir", () => {
  const token = createSessionToken(SECRET, "admin", 1000, 5000);
  const [, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "baskasi", exp: 999999 })).toString("base64url");
  assert.equal(verifySessionToken(SECRET, `${forged}.${sig}`, 2000), null);
});

test("boş veya bozuk token reddedilir", () => {
  assert.equal(verifySessionToken(SECRET, undefined), null);
  assert.equal(verifySessionToken(SECRET, ""), null);
  assert.equal(verifySessionToken(SECRET, "a.b.c"), null);
  assert.equal(verifySessionToken(SECRET, "yalnizca-bir-parca"), null);
});

test("çerez başlığından değer okunur", () => {
  assert.equal(getCookie("a=1; tndrwa_session=abc%2Fdef; b=2", "tndrwa_session"), "abc/def");
  assert.equal(getCookie("a=1", "tndrwa_session"), undefined);
  assert.equal(getCookie(undefined, "x"), undefined);
});

test("oturum süresinin yarısı geçince yenilenir", () => {
  const now = 10 * SESSION_TTL_MS;
  assert.equal(shouldRenewSession(now + SESSION_TTL_MS, now), false);
  assert.equal(shouldRenewSession(now + SESSION_TTL_MS / 2 + 1000, now), false);
  assert.equal(shouldRenewSession(now + SESSION_TTL_MS / 2 - 1000, now), true);
});

test("oturum çerezi başlığı: üretimde Secure, silmede Max-Age=0", () => {
  assert.match(sessionCookieHeader("a/b", true), /^tndrwa_session=a%2Fb; Max-Age=604800; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
  assert.doesNotMatch(sessionCookieHeader("x", false), /Secure/);
  assert.match(sessionCookieHeader(null, false), /^tndrwa_session=; Max-Age=0;/);
});
