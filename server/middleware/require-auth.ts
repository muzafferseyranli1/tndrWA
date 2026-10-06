import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE, getCookie, verifySessionToken } from "../lib/session";

// /uploads/: Meta ürün görsellerini girişsiz çekebilmeli
const PUBLIC_PREFIXES = ["/_next/", "/favicon.ico", "/uploads/"];
// /api/webhooks/waha: WAHA oturumsuz çağırır; kimlik doğrulaması HMAC imzasıyla yapılır
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/health", "/api/webhooks/waha"]);

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

export function requireAuth(sessionSecret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isPublicPath(req.path)) return next();

    const session = verifySessionToken(sessionSecret, getCookie(req.headers.cookie, SESSION_COOKIE));
    if (session) {
      res.locals.username = session.username;
      return next();
    }

    if (req.path.startsWith("/api/")) {
      res.status(401).json({ error: "Oturum gerekli." });
      return;
    }
    res.redirect("/login");
  };
}
