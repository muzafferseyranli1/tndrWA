import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "tndrwa_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Payload {
  u: string;
  exp: number;
}

function sign(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function createSessionToken(secret: string, username: string, now = Date.now(), ttlMs = SESSION_TTL_MS): string {
  const payload: Payload = { u: username, exp: now + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(secret, body).toString("base64url")}`;
}

export function verifySessionToken(secret: string, token: string | undefined, now = Date.now()): { username: string } | null {
  if (!token) return null;
  const [body, sig, ...rest] = token.split(".");
  if (!body || !sig || rest.length) return null;

  const expected = sign(secret, body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<Payload>;
    if (typeof payload.u !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp <= now) return null;
    return { username: payload.u };
  } catch {
    return null;
  }
}

export function getCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}
