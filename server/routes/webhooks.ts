import express, { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Env } from "../lib/env";
import { logger } from "../lib/logger";
import { verifyWahaSignature } from "../lib/waha-hmac";

/** WAHA motorlarına göre mesaj türü farklı yerde durur; ham gövde her zaman saklandığı için en iyi tahmin yeterli. */
export function detectMessageType(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const data = (p._data ?? p._Data) as Record<string, unknown> | undefined;
  if (typeof p.type === "string") return p.type;
  if (data && typeof data.type === "string") return data.type;
  // Baileys (NOWEB): _data.message.<tür>Message ; whatsmeow (GOWS): _data.Message.<Tür>
  for (const key of ["message", "Message"]) {
    const msg = data?.[key];
    if (msg && typeof msg === "object") {
      const first = Object.entries(msg as Record<string, unknown>).find(([, v]) => v !== null && v !== undefined && v !== "");
      if (first) return first[0];
    }
  }
  return null;
}

const DISCOVERY_TYPE = /order|product|catalog|cart/i;
// Ham metinde yalnızca JSON ANAHTARI olarak geçen eşleşmeler sayılır ("orderMessage": ...). Şifreli base64 verideki rastgele harf dizileri sayılmaz.
const DISCOVERY_KEY = /"[A-Za-z_]*(order|product|catalog|cart)[A-Za-z_]*"\s*:/i;

/** Sipariş/ürün/katalog olayı mı (günlüğe ham içerik yazılsın mı)? */
export function isDiscoveryEvent(event: string, messageType: string | null, rawText: string): boolean {
  if (messageType && DISCOVERY_TYPE.test(messageType)) return true;
  return event === "engine.event" && DISCOVERY_KEY.test(rawText);
}

export function webhooksRouter(db: PrismaClient, env: Env): Router {
  const router = Router();

  // Ham gövde gerekir: imza, JSON'a çevrilmeden önceki baytlar üzerinden doğrulanır
  router.post("/waha", express.raw({ type: () => true, limit: "5mb" }), async (req, res) => {
    if (!env.waha) return res.status(503).json({ error: "WAHA ayarları tanımlı değil." });
    const raw = req.body;
    if (!Buffer.isBuffer(raw) || raw.length === 0) return res.status(400).json({ error: "Boş gövde." });

    if (!verifyWahaSignature(raw, env.waha.hmacKey, req.header("x-webhook-hmac"))) {
      logger.warn({ ip: req.ip }, "WAHA webhook: imza geçersiz");
      return res.status(401).json({ error: "İmza geçersiz." });
    }

    let parsed: { event?: unknown; session?: unknown; payload?: unknown };
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Geçersiz JSON." });
    }
    const event = typeof parsed.event === "string" ? parsed.event : "bilinmeyen";
    const session = typeof parsed.session === "string" ? parsed.session : "bilinmeyen";
    const messageType = event.startsWith("message") ? detectMessageType(parsed.payload) : null;
    const text = raw.toString("utf8");

    try {
      await db.webhookEvent.create({
        data: { requestId: req.header("x-webhook-request-id") ?? null, session, event, messageType, body: text },
      });
    } catch (err) {
      // Aynı istek kimliği tekrar geldi (WAHA yeniden denemesi): zaten kayıtlı, başarılı say
      if ((err as { code?: string }).code === "P2002") return res.json({ ok: true, duplicate: true });
      logger.error({ err }, "WAHA webhook kaydedilemedi");
      return res.status(500).json({ error: "Kaydedilemedi." });
    }

    logger.info({ event, session, messageType }, "WAHA olayı alındı");
    // Sipariş/ürün/katalog mesajlarının biçimini keşfetmek için ham içerik günlüğe de (kısaltılmış) yazılır
    if (isDiscoveryEvent(event, messageType, text)) {
      logger.info({ event, session, messageType, raw: text.slice(0, 6000) }, "WAHA keşif: sipariş/katalog olayı");
    }
    res.json({ ok: true });
  });

  return router;
}

/** Eski olayları siler (kişisel veri). Silinen kayıt sayısını döndürür. */
export async function purgeOldWebhookEvents(db: PrismaClient, days = 14, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const res = await db.webhookEvent.deleteMany({ where: { receivedAt: { lt: cutoff } } });
  return res.count;
}
