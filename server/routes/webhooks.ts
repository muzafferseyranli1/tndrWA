import express, { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Env } from "../lib/env";
import { logger } from "../lib/logger";
import { sameSecret, verifyMetaSignature } from "../lib/meta-signature";
import { verifyWahaSignature } from "../lib/waha-hmac";
import { extractCloudEvents } from "../services/whatsapp-cloud";
import { ingestCloudOrder } from "../services/orders";

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

/**
 * Günlük için küçültür: 200 karakterden uzun metinleri (base64 küçük resim, şifreli veri) kısaltır,
 * böylece siparişin asıl alanları kesilmeden okunabilir. JSON değilse düz kırpar.
 */
export function compactForLog(rawText: string, maxChars = 8000): string {
  const shrink = (v: unknown): unknown => {
    if (typeof v === "string") return v.length > 200 ? `<${v.length} karakter>` : v;
    if (Array.isArray(v)) return v.map(shrink);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shrink(x)]));
    return v;
  };
  try {
    return JSON.stringify(shrink(JSON.parse(rawText))).slice(0, maxChars);
  } catch {
    return rawText.slice(0, maxChars);
  }
}

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
      logger.info({ event, session, messageType, raw: compactForLog(text) }, "WAHA keşif: sipariş/katalog olayı");
    }
    res.json({ ok: true });
  });

  // ---- Resmi WhatsApp Cloud API (Meta) ----
  // Meta, webhook adresini kaydederken önce GET ile "hub.challenge" doğrulaması yapar.
  router.get("/meta", (req, res) => {
    const cloud = env.whatsappCloud;
    if (!cloud) return res.status(503).send("WhatsApp Cloud API ayarları tanımlı değil.");
    const mode = req.query["hub.mode"];
    const token = typeof req.query["hub.verify_token"] === "string" ? req.query["hub.verify_token"] : undefined;
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && sameSecret(token, cloud.verifyToken) && typeof challenge === "string") {
      logger.info("Meta webhook doğrulandı");
      return res.status(200).type("text/plain").send(challenge);
    }
    logger.warn({ ip: req.ip }, "Meta webhook doğrulaması reddedildi");
    return res.status(403).send("Doğrulama başarısız.");
  });

  router.post("/meta", express.raw({ type: () => true, limit: "5mb" }), async (req, res) => {
    const cloud = env.whatsappCloud;
    if (!cloud) return res.status(503).json({ error: "WhatsApp Cloud API ayarları tanımlı değil." });
    const raw = req.body;
    if (!Buffer.isBuffer(raw) || raw.length === 0) return res.status(400).json({ error: "Boş gövde." });
    if (!verifyMetaSignature(raw, cloud.appSecret, req.header("x-hub-signature-256"))) {
      logger.warn({ ip: req.ip }, "Meta webhook: imza geçersiz");
      return res.status(401).json({ error: "İmza geçersiz." });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Geçersiz JSON." });
    }

    let stored = 0;
    for (const ev of extractCloudEvents(payload)) {
      try {
        await db.webhookEvent.create({ data: { requestId: ev.requestId, session: ev.session, event: ev.event, messageType: ev.messageType, body: ev.body } });
        stored++;
        logger.info({ event: ev.event, session: ev.session, messageType: ev.messageType }, "Cloud API olayı alındı");
      } catch (err) {
        // Meta aynı olayı yeniden gönderdi. Sipariş işlemi tekrar güvenli olduğundan siparişler yine de işlenir (önceki deneme yarım kalmış olabilir).
        if ((err as { code?: string }).code !== "P2002") {
          logger.error({ err }, "Meta webhook olayı kaydedilemedi");
          return res.status(500).json({ error: "Kaydedilemedi." }); // Meta yeniden dener
        }
      }
      if (ev.messageType === "order") {
        try {
          const result = await ingestCloudOrder(db, ev.body);
          if (result.status === "created") logger.info({ orderId: result.order.id, brandId: result.order.brandId, toplamKurus: result.order.totalKurus }, "Sipariş kaydedildi");
          else if (result.status === "skipped") logger.warn({ session: ev.session, reason: result.reason }, "Sipariş kaydedilmedi");
        } catch (err) {
          logger.error({ err }, "Sipariş işlenemedi");
          return res.status(500).json({ error: "Sipariş kaydedilemedi." }); // Meta yeniden dener; olay kaydı tekrarda 'duplicate' sayılır
        }
      }
    }
    res.json({ ok: true, stored });
  });

  return router;
}

/** Eski olayları siler (kişisel veri). Silinen kayıt sayısını döndürür. */
export async function purgeOldWebhookEvents(db: PrismaClient, days = 14, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const res = await db.webhookEvent.deleteMany({ where: { receivedAt: { lt: cutoff } } });
  return res.count;
}
