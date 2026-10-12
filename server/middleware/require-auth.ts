import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE, getCookie, verifySessionToken } from "../lib/session";

export type Role = "ADMIN" | "USER";

// /uploads/: Meta ürün görsellerini girişsiz çekebilmeli
// / ve /m/<marka>: herkese açık açılış sayfası (QR kodunun gittiği yer); /api/public/: onun verisi ve sayacı
const PUBLIC_PREFIXES = ["/_next/", "/favicon.ico", "/uploads/", "/m/", "/api/public/"];
// /api/webhooks/waha: WAHA oturumsuz çağırır; kimlik doğrulaması HMAC imzasıyla yapılır
const PUBLIC_PATHS = new Set(["/", "/gizlilik", "/veri-silme", "/login", "/api/auth/login", "/api/health", "/api/webhooks/waha", "/api/webhooks/meta"]);

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

/** USER rolünün (kasa/mutfak personeli) açabildiği sayfalar. */
const USER_PAGES = ["/orders", "/chat"];

/**
 * USER rolünün erişebildiği API'ler: sipariş ve yazışma işlemleri tam; marka, ürün listesi (sipariş düzenlemede ürün eklemek için),
 * ödeme tipleri, saatler, uyarı sesi ve müşteri adresleri yalnızca okunur; ürünü "bugün tükendi" yapabilir.
 */
export function userCanAccess(method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (path.startsWith("/api/auth/")) return true;
  if (path === "/api/orders" || path.startsWith("/api/orders/") || path === "/api/chat" || path.startsWith("/api/chat/")) return true;
  if (m === "POST" && /^\/api\/products\/\d+\/sold-out$/.test(path)) return true;
  if (m !== "GET" && m !== "HEAD") return false;
  return ["/api/brands", "/api/products", "/api/payments", "/api/hours", "/api/sound"].some((p) => path === p || path.startsWith(`${p}/`)) || /^\/api\/customers\/\d+\/addresses$/.test(path);
}

export interface AuthOptions {
  /** Ortamdaki yönetici kullanıcı adı: her zaman ADMIN */
  adminUsername: string;
  /** Diğer kullanıcılar için kayıt araması (pasif ya da silinmiş kullanıcı için null) */
  lookup: (username: string) => Promise<{ role: Role } | null>;
}

export function requireAuth(sessionSecret: string, options?: AuthOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (isPublicPath(req.path)) return next();

    const session = verifySessionToken(sessionSecret, getCookie(req.headers.cookie, SESSION_COOKIE));
    let role: Role | null = null;
    if (session) {
      if (!options || session.username === options.adminUsername) role = "ADMIN";
      else role = (await options.lookup(session.username).catch(() => null))?.role ?? null;
    }

    if (session && role) {
      res.locals.username = session.username;
      res.locals.role = role;
      if (role === "USER") {
        const api = req.path.startsWith("/api/");
        const allowed = api ? userCanAccess(req.method, req.path) : USER_PAGES.some((p) => req.path === p || req.path.startsWith(`${p}/`));
        if (!allowed) {
          if (api) res.status(403).json({ error: "Bu işlem için yetkiniz yok." });
          else res.redirect("/orders");
          return;
        }
      }
      return next();
    }

    if (req.path.startsWith("/api/")) {
      res.status(401).json({ error: "Oturum gerekli." });
      return;
    }
    res.redirect("/login");
  };
}
