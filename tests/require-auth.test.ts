import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicPath } from "../server/middleware/require-auth";

test("giriş, sağlık ve statik yollar herkese açık", () => {
  for (const p of ["/login", "/api/auth/login", "/api/health", "/api/webhooks/waha", "/api/webhooks/meta", "/_next/static/chunks/a.js", "/favicon.ico"]) {
    assert.equal(isPublicPath(p), true, p);
  }
});

test("panel ve API yolları korumalı", () => {
  for (const p of ["/", "/api/auth/me", "/api/auth/logout", "/api/products", "/orders", "/login/x"]) {
    assert.equal(isPublicPath(p), false, p);
  }
});
