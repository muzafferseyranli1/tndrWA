import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import { createSessionToken } from "../server/lib/session";
import { requireAuth, userCanAccess } from "../server/middleware/require-auth";

const SECRET = "s".repeat(40);

test("USER: sipariş ve yazışma tam; ürün/ödeme/saat yalnızca okuma; tükendi işaretleyebilir", () => {
  for (const [m, p] of [["GET", "/api/orders"], ["PATCH", "/api/orders/5"], ["POST", "/api/orders/5/items"], ["POST", "/api/chat/3/send"], ["GET", "/api/products"], ["POST", "/api/products/9/sold-out"], ["GET", "/api/payments"], ["GET", "/api/hours"], ["GET", "/api/customers/4/addresses"], ["GET", "/api/auth/me"], ["POST", "/api/auth/logout"], ["GET", "/api/sound"]] as const) {
    assert.equal(userCanAccess(m, p), true, `${m} ${p}`);
  }
});

test("USER: yönetim uçları kapalı", () => {
  for (const [m, p] of [["GET", "/api/staff"], ["POST", "/api/products"], ["PATCH", "/api/products/9"], ["POST", "/api/products/9/image"], ["PUT", "/api/payments/1"], ["PUT", "/api/hours"], ["GET", "/api/business"], ["GET", "/api/customers"], ["GET", "/api/backups"], ["POST", "/api/sound"], ["PATCH", "/api/brands/1"], ["GET", "/api/messages"], ["GET", "/api/ratings"], ["GET", "/api/whatsapp/cloud/status"]] as const) {
    assert.equal(userCanAccess(m, p), false, `${m} ${p}`);
  }
});

function run(options: Parameters<typeof requireAuth>[1], method: string, path: string, username?: string) {
  const out: { next: boolean; status?: number; redirect?: string; locals: Record<string, unknown> } = { next: false, locals: {} };
  const req = { path, method, headers: { cookie: username ? `tndrwa_session=${createSessionToken(SECRET, username)}` : "" } } as unknown as Request;
  const res = {
    locals: out.locals,
    status(code: number) {
      out.status = code;
      return this;
    },
    json() {
      return this;
    },
    redirect(to: string) {
      out.redirect = to;
    },
  } as unknown as Response;
  const next: NextFunction = () => {
    out.next = true;
  };
  return requireAuth(SECRET, options)(req, res, next).then(() => out);
}

const options = {
  adminUsername: "owner",
  lookup: async (u: string) => (u === "kasa" ? { role: "USER" as const } : u === "mudur" ? { role: "ADMIN" as const } : null),
};

test("ortam yöneticisi ve ADMIN personel her yere girer", async () => {
  assert.equal((await run(options, "GET", "/api/staff", "owner")).next, true);
  const r = await run(options, "GET", "/api/staff", "mudur");
  assert.equal(r.next, true);
  assert.equal(r.locals.role, "ADMIN");
});

test("USER rolü yasaklı API'de 403, yasaklı sayfada siparişlere yönlenir, izinlilere girer", async () => {
  assert.equal((await run(options, "GET", "/api/staff", "kasa")).status, 403);
  assert.equal((await run(options, "GET", "/products", "kasa")).redirect, "/orders");
  assert.equal((await run(options, "GET", "/panel", "kasa")).redirect, "/orders");
  assert.equal((await run(options, "GET", "/orders", "kasa")).next, true);
  assert.equal((await run(options, "GET", "/chat", "kasa")).next, true);
  assert.equal((await run(options, "GET", "/api/orders", "kasa")).locals.role, "USER");
});

test("silinmiş ya da pasif kullanıcının eski oturumu geçersiz", async () => {
  assert.equal((await run(options, "GET", "/api/orders", "eski")).status, 401);
  assert.equal((await run(options, "GET", "/orders", "eski")).redirect, "/login");
});

test("oturumsuz istek reddedilir", async () => {
  assert.equal((await run(options, "GET", "/api/orders")).status, 401);
});
