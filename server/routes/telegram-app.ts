import express, { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { Env } from "../lib/env";
import { logger } from "../lib/logger";
import { sendClosedNotice, sendMinBasketNotice, sendPreorderNoticeIfNeeded } from "../services/hours";
import type { Gateway } from "../services/messenger";
import { offerMergeOrStart } from "../services/order-flow";
import { SHARE_PHONE, say, upsertTelegramCustomer, type TelegramContext } from "../services/telegram-bot";
import { buildMenu, createTelegramOrder, MAX_LINES, validateInitData } from "../services/telegram-app";

const WINDOW_MS = 60_000;
/** Doğrulanmış Telegram kullanıcısı başına dakikada en fazla bu kadar sipariş denemesi; IP başına sınır (imza doğrulanmadan önce) daha gevşektir */
const MAX_ORDERS_PER_USER = 12;
const MAX_REQUESTS_PER_IP = 90;

const orderBody = z.object({
  brand: z.string().min(1).max(40),
  initData: z.string().min(10).max(4096),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  note: z.string().max(400).optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int(),
        quantity: z.number().int(),
        options: z.array(z.object({ groupId: z.number().int(), choiceIds: z.array(z.number().int()).max(20) })).max(20).default([]),
      }),
    )
    .max(MAX_LINES),
});

/**
 * Telegram Mini App uçları (/api/tg, oturum çerezi yok): menü herkese açık veridir; sipariş ve kullanıcı bilgisi
 * Telegram'ın imzaladığı initData ile doğrulanır (imza bot jetonuyla atılır, bu yüzden başkası adına sipariş verilemez).
 */
export function telegramAppRouter(db: PrismaClient, env: Env, gateway: Gateway): Router {
  const router = Router();
  router.use(express.json({ limit: "64kb" }));

  const buckets = new Map<string, { count: number; resetAt: number }>();
  const allowed = (key: string, max: number, now = Date.now()) => {
    const b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
      if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      return true;
    }
    return ++b.count <= max;
  };

  const botOf = async (code: unknown) => {
    const brandCode = typeof code === "string" ? code.toLowerCase() : "";
    const token = env.telegram?.bots[brandCode];
    const brand = token ? await db.brand.findUnique({ where: { code: brandCode } }) : null;
    return brand && token ? { brand, token } : null;
  };

  router.get("/menu", async (req, res) => {
    const bot = await botOf(req.query.brand);
    if (!bot) return res.status(404).json({ error: "Bu marka için Telegram menüsü yok." });
    const menu = await buildMenu(db, bot.brand);
    // Telegram imzası geçerliyse müşterinin telefonu kayıtlı mı bilinir (sepette numara istenip istenmeyeceği)
    let me: { needsPhone: boolean; name: string | null } | null = null;
    const initData = req.header("x-telegram-init-data");
    if (initData) {
      const v = validateInitData(initData, bot.token);
      if (v.ok) {
        const known = await db.customer.findUnique({ where: { tgId: String(v.user.id) } });
        me = { needsPhone: !known?.waId, name: known?.name ?? ([v.user.first_name, v.user.last_name].filter(Boolean).join(" ").trim() || null) };
      }
    }
    res.set("Cache-Control", "no-store").json({ ...menu, me });
  });

  router.post("/order", async (req, res) => {
    if (!allowed(`ip:${req.ip ?? "?"}`, MAX_REQUESTS_PER_IP)) return res.status(429).json({ error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." });
    const parsed = orderBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ code: "invalid", error: "Sipariş bilgisi okunamadı." });
    const bot = await botOf(parsed.data.brand);
    if (!bot) return res.status(404).json({ code: "invalid", error: "Bu marka için Telegram siparişi alınmıyor." });
    const auth = validateInitData(parsed.data.initData, bot.token);
    if (!auth.ok) {
      logger.warn({ brand: bot.brand.code, reason: auth.reason }, "Mini App siparişi: kimlik doğrulanamadı");
      return res.status(401).json({ code: "auth", error: "Telegram oturumu doğrulanamadı. Menüyü kapatıp botun menü düğmesinden yeniden açın." });
    }

    if (!allowed(`user:${bot.brand.code}:${auth.user.id}`, MAX_ORDERS_PER_USER)) return res.status(429).json({ code: "rate", error: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." });

    const customer = await upsertTelegramCustomer(db, auth.user);
    const client = gateway.telegramClient(bot.brand.code);
    const ctx: TelegramContext | null = client ? { db, brand: bot.brand, client, gateway, publicBaseUrl: env.publicBaseUrl } : null;

    const result = await createTelegramOrder(db, { brand: bot.brand, customer, requestId: parsed.data.requestId, lines: parsed.data.items, note: parsed.data.note });
    if (result.status === "duplicate") return res.json({ ok: true, orderId: result.orderId, duplicate: true });
    if (result.status === "rejected") {
      // Sohbete de bilgi düşer: müşteri Mini App'i kapatınca ne olduğunu orada görür
      if (result.reason === "phone" && ctx) await say(ctx, customer, "Siparişinizi alabilmemiz için aşağıdaki düğmeyle telefon numaranızı paylaşın, sonra menüden tekrar deneyin.", SHARE_PHONE);
      if (result.reason === "closed") void sendClosedNotice(db, gateway, bot.brand, customer, new Date(), "telegram");
      if (result.reason === "minBasket") void sendMinBasketNotice(db, gateway, bot.brand, customer, result.totalKurus ?? 0, result.minKurus ?? 0, "telegram");
      return res.status(409).json({ code: result.reason, error: result.message, minKurus: result.minKurus });
    }

    logger.info({ orderId: result.order.id, brand: bot.brand.code, toplamKurus: result.order.totalKurus }, "Telegram siparişi kaydedildi");
    res.json({ ok: true, orderId: result.order.id });
    // Sipariş akışı sohbette sürer: (açılış öncesi notu) → açık siparişe ekleme sorusu ya da KVKK/ödeme sorusu
    void sendPreorderNoticeIfNeeded(db, gateway, result.order.id).then(() => offerMergeOrStart(db, gateway, result.order.id));
  });

  return router;
}
