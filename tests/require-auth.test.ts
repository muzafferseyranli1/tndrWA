import assert from "node:assert/strict";
import { test } from "node:test";
import { isPublicPath } from "../server/middleware/require-auth";

test("giriş, sağlık, statik yollar ve açılış sayfası herkese açık", () => {
  for (const p of ["/", "/m/tandir", "/m/pide", "/api/public/brands", "/api/public/hit", "/login", "/api/auth/login", "/api/health", "/api/webhooks/waha", "/api/webhooks/meta", "/_next/static/chunks/a.js", "/favicon.ico"]) {
    assert.equal(isPublicPath(p), true, p);
  }
});

test("panel ve API yolları korumalı", () => {
  for (const p of ["/panel", "/api/auth/me", "/api/auth/logout", "/api/products", "/api/channels", "/api/channels/qr", "/orders", "/channels", "/login/x", "/m", "/api/publicx"]) {
    assert.equal(isPublicPath(p), false, p);
  }
});
