import express, { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Env } from "../lib/env";
import { verifyPassword } from "../lib/password";
import { AttemptLimiter } from "../lib/attempt-limiter";
import { createSessionToken, sessionCookieHeader } from "../lib/session";

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// Kullanıcı bulunamasa da şifre doğrulaması çalışsın diye karşılaştırılan sahte özet
const DUMMY_HASH = "scrypt:16384:8:1:AAAAAAAAAAAAAAAAAAAAAA:" + "A".repeat(86);

export function authRouter(env: Env, db: PrismaClient, limiter = new AttemptLimiter(5, 15 * 60 * 1000)): Router {
  const router = Router();
  const secure = env.nodeEnv === "production";

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
    const isEnvAdmin = safeEqual(username, env.adminUsername);
    const staff = isEnvAdmin ? null : await db.staffUser.findUnique({ where: { username: username.trim().toLowerCase() } }).catch(() => null);
    const passwordOk = await verifyPassword(password, isEnvAdmin ? env.adminPasswordHash : (staff?.passwordHash ?? DUMMY_HASH));
    const ok = passwordOk && (isEnvAdmin || (!!staff && staff.active));
    const role = isEnvAdmin ? "ADMIN" : (staff?.role ?? "USER");

    if (!ok) {
      limiter.recordFailure(ip);
      res.status(401).json({ error: "Kullanıcı adı veya şifre hatalı." });
      return;
    }

    limiter.reset(ip);
    const token = createSessionToken(env.sessionSecret, isEnvAdmin ? env.adminUsername : staff!.username);
    res.setHeader("Set-Cookie", sessionCookieHeader(token, secure));
    res.json({ ok: true, role });
  });

  router.post("/logout", (_req, res) => {
    res.setHeader("Set-Cookie", sessionCookieHeader(null, secure));
    res.json({ ok: true });
  });

  router.get("/me", (_req, res) => {
    res.json({ username: res.locals.username as string, role: (res.locals.role as string | undefined) ?? "ADMIN" });
  });

  return router;
}
