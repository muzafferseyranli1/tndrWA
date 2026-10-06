import express, { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import type { Env } from "../lib/env";
import { verifyPassword } from "../lib/password";
import { AttemptLimiter } from "../lib/attempt-limiter";
import { SESSION_COOKIE, SESSION_TTL_MS, createSessionToken } from "../lib/session";

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function authRouter(env: Env, limiter = new AttemptLimiter(5, 15 * 60 * 1000)): Router {
  const router = Router();
  const secure = env.nodeEnv === "production";
  const cookieBase = `${SESSION_COOKIE}=`;
  const attrs = `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

  router.use(express.json({ limit: "10kb" }));

  router.post("/login", async (req, res) => {
    const ip = req.ip ?? "bilinmiyor";
    if (limiter.isBlocked(ip)) {
      res.status(429).json({ error: "Çok fazla deneme. 15 dakika sonra tekrar deneyin." });
      return;
    }

    const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "Kullanıcı adı ve şifre gerekli." });
      return;
    }

    // Kullanıcı adı yanlış olsa bile şifre doğrulaması çalışsın (süre farkı sızdırmasın)
    const passwordOk = await verifyPassword(password, env.adminPasswordHash);
    const ok = safeEqual(username, env.adminUsername) && passwordOk;

    if (!ok) {
      limiter.recordFailure(ip);
      res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı." });
      return;
    }

    limiter.reset(ip);
    const token = createSessionToken(env.sessionSecret, env.adminUsername);
    res.setHeader("Set-Cookie", `${cookieBase}${encodeURIComponent(token)}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; ${attrs}`);
    res.json({ ok: true });
  });

  router.post("/logout", (_req, res) => {
    res.setHeader("Set-Cookie", `${cookieBase}; Max-Age=0; ${attrs}`);
    res.json({ ok: true });
  });

  router.get("/me", (_req, res) => {
    res.json({ username: res.locals.username as string });
  });

  return router;
}
