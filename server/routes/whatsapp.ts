import express, { Router, type Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { Env } from "../lib/env";
import { resolveBrand } from "../services/brands";
import { WahaClient, WahaError } from "../services/waha";
import { CloudApiError, type PhoneInfo, type WhatsappCloudClient } from "../services/whatsapp-cloud";

export interface WhatsappStatusDto {
  configured: boolean;
  session: string | null;
  /** STOPPED | STARTING | SCAN_QR_CODE | WORKING | FAILED | NOT_CREATED */
  status: string | null;
  me: string | null;
  error: string | null;
  blockers: string[];
}

export interface CloudStatusDto {
  /** Webhook için gerekli ayarlar (uygulama sırrı + doğrulama anahtarı) tanımlı mı */
  webhookConfigured: boolean;
  /** Mesaj göndermek için kalıcı jeton tanımlı mı */
  tokenSet: boolean;
  phoneNumberId: string | null;
  webhookUrl: string | null;
  info: PhoneInfo | null;
  error: string | null;
}

export function whatsappRouter(db: PrismaClient, env: Env, client: WahaClient | null, cloud: WhatsappCloudClient | null = null): Router {
  const router = Router();
  router.use(express.json({ limit: "5kb" }));
  const webhookUrl = env.publicBaseUrl ? `${env.publicBaseUrl}/api/webhooks/waha` : null;

  async function brandOf(raw: unknown, res: Response) {
    const brand = await resolveBrand(db, raw);
    if (!brand) res.status(404).json({ error: "Marka bulunamadı." });
    return brand;
  }

  router.get("/status", async (req, res) => {
    const brand = await brandOf(req.query.brandId, res);
    if (!brand) return;
    const blockers: string[] = [];
    if (!client) blockers.push("WAHA ayarları eksik (WAHA_URL, WAHA_API_KEY, WAHA_WEBHOOK_HMAC_KEY)");
    if (!brand.waSession) blockers.push(`${brand.name} için WAHA oturum adı girilmemiş (Markalar sayfası)`);
    const dto: WhatsappStatusDto = { configured: blockers.length === 0, session: brand.waSession, status: null, me: null, error: null, blockers };
    if (!client || !brand.waSession) return res.json(dto);
    try {
      const s = await client.getSession(brand.waSession);
      dto.status = s ? s.status : "NOT_CREATED";
      dto.me = s?.me?.pushName ?? s?.me?.id ?? null;
    } catch (err) {
      dto.error = (err as Error).message;
    }
    res.json(dto);
  });

  router.get("/qr", async (req, res) => {
    const brand = await brandOf(req.query.brandId, res);
    if (!brand) return;
    if (!client || !brand.waSession) return res.status(503).json({ error: "WAHA ayarları eksik." });
    try {
      const qr = await client.qr(brand.waSession);
      if (!qr) return res.status(404).json({ error: "Şu an QR kodu yok (oturum QR beklemiyor)." });
      res.setHeader("Content-Type", qr.contentType);
      res.setHeader("Cache-Control", "no-store");
      res.send(qr.buffer);
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  router.post("/start", async (req, res) => {
    const parsed = z.object({ brandId: z.number().int().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Geçersiz istek." });
    const brand = await brandOf(parsed.data.brandId, res);
    if (!brand) return;
    if (!client || !brand.waSession || !webhookUrl) return res.status(503).json({ error: "WAHA, oturum adı veya PUBLIC_BASE_URL ayarı eksik." });
    try {
      const s = await client.startSession(brand.waSession, webhookUrl);
      res.json({ session: brand.waSession, status: s.status });
    } catch (err) {
      res.status(err instanceof WahaError ? 502 : 500).json({ error: (err as Error).message });
    }
  });

  router.post("/stop", async (req, res) => {
    const parsed = z.object({ brandId: z.number().int().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Geçersiz istek." });
    const brand = await brandOf(parsed.data.brandId, res);
    if (!brand) return;
    if (!client || !brand.waSession) return res.status(503).json({ error: "WAHA ayarları eksik." });
    try {
      await client.stopSession(brand.waSession);
      res.json({ session: brand.waSession, status: "STOPPED" });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  // Son webhook olayları (ham gövde olmadan): bağlantının çalıştığını görmek için
  router.get("/events", async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const brand = await brandOf(req.query.brandId, res);
    if (!brand) return;
    // Bu markanın hem WAHA oturumunun hem de resmi Cloud API numarasının olayları
    const sessions = [brand.waSession, brand.waPhoneNumberId ? `cloud:${brand.waPhoneNumberId}` : null].filter((x): x is string => !!x);
    const events = await db.webhookEvent.findMany({
      where: sessions.length ? { session: { in: sessions } } : { id: -1 },
      orderBy: { id: "desc" },
      take: limit,
      select: { id: true, receivedAt: true, session: true, event: true, messageType: true },
    });
    res.json(events.map((e) => ({ ...e, receivedAt: e.receivedAt.toISOString() })));
  });

  // ---- Resmi WhatsApp Cloud API ----
  router.get("/cloud/status", async (req, res) => {
    const brand = await brandOf(req.query.brandId, res);
    if (!brand) return;
    const dto: CloudStatusDto = {
      webhookConfigured: !!env.whatsappCloud,
      tokenSet: !!env.whatsappCloud?.token,
      phoneNumberId: brand.waPhoneNumberId,
      webhookUrl: env.publicBaseUrl ? `${env.publicBaseUrl}/api/webhooks/meta` : null,
      info: null,
      error: null,
    };
    if (cloud && brand.waPhoneNumberId) {
      try {
        dto.info = await cloud.phoneInfo(brand.waPhoneNumberId);
      } catch (err) {
        dto.error = (err as Error).message;
      }
    }
    res.json(dto);
  });

  // Deneme mesajı: markanın Cloud API numarasından gönderir (test numarası yalnızca kayıtlı alıcılara yazabilir)
  router.post("/cloud/send", async (req, res) => {
    const parsed = z
      .object({ brandId: z.number().int().optional(), catalog: z.boolean().optional(), to: z.string().trim().regex(/^\+?\d{8,15}$/, "Alıcı numarası ülke koduyla yazılmalı (örn. 905551112233)."), text: z.string().trim().min(1, "Mesaj boş olamaz.").max(1000) })
      .safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Geçersiz istek." });
    const brand = await brandOf(parsed.data.brandId, res);
    if (!brand) return;
    if (!cloud) return res.status(503).json({ error: "WhatsApp Cloud API jetonu (WHATSAPP_CLOUD_TOKEN) tanımlı değil." });
    if (!brand.waPhoneNumberId) return res.status(503).json({ error: `${brand.name} için Cloud API telefon numarası kimliği girilmemiş (Markalar sayfası).` });
    try {
      const to = parsed.data.to.replace(/^\+/, "");
      const id = parsed.data.catalog ? await cloud.sendCatalog(brand.waPhoneNumberId, to, parsed.data.text) : await cloud.sendText(brand.waPhoneNumberId, to, parsed.data.text);
      res.json({ ok: true, messageId: id });
    } catch (err) {
      res.status(err instanceof CloudApiError ? 502 : 500).json({ error: (err as Error).message });
    }
  });

  // Tek olayın ham içeriği (sipariş mesajı biçimini incelemek için)
  router.get("/events/:id", async (req, res) => {
    const id = Number(req.params.id);
    const ev = Number.isInteger(id) ? await db.webhookEvent.findUnique({ where: { id } }) : null;
    if (!ev) return res.status(404).json({ error: "Olay bulunamadı." });
    let body: unknown = ev.body;
    try {
      body = JSON.parse(ev.body);
    } catch {
      /* ham metin olarak döner */
    }
    res.json({ id: ev.id, receivedAt: ev.receivedAt.toISOString(), session: ev.session, event: ev.event, messageType: ev.messageType, body });
  });

  return router;
}
