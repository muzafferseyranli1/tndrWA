import express from "express";
import next from "next";
import { EnvError, loadEnv } from "./lib/env";
import { logger } from "./lib/logger";
import { db } from "./lib/db";
import { requireAuth } from "./middleware/require-auth";
import { authRouter } from "./routes/auth";
import { categoriesRouter, productsRouter } from "./routes/products";
import { imagesRouter } from "./routes/images";
import { metaRouter } from "./routes/meta";
import { brandsRouter } from "./routes/brands";
import { purgeOldWebhookEvents, webhooksRouter } from "./routes/webhooks";
import { whatsappRouter } from "./routes/whatsapp";
import { ordersRouter } from "./routes/orders";
import { soundRouter } from "./routes/sound";
import { messagesRouter } from "./routes/messages";
import { chatRouter } from "./routes/chat";
import { publicRouter } from "./routes/public";
import { channelsRouter } from "./routes/channels";
import { paymentsRouter } from "./routes/payments";
import { ratingsRouter } from "./routes/ratings";
import { customersRouter } from "./routes/customers";
import { ensureDefaultChannels } from "./services/channels";
import { handleOrderReply, startOrderConversation } from "./services/order-flow";
import { ensureDefaultPaymentTypes } from "./services/payment";
import { sendWelcomeIfNeeded } from "./services/chat";
import { WahaClient } from "./services/waha";
import { WhatsappCloudClient } from "./services/whatsapp-cloud";
import { bootstrapBrands } from "./services/brands";
import { SyncCoordinator, handlePublicUrlChange, refreshExpiredSoldOut } from "./services/meta-sync";
import path from "node:path";

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    // Eksik yapılandırmada sessizce devam etme: açık hata ile dur.
    console.error(err instanceof EnvError ? err.message : err);
    process.exit(1);
  }

  const dev = env.nodeEnv !== "production";
  const nextApp = next({ dev, dir: process.cwd() });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // Traefik arkasında gerçek istemci IP'si

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });

  app.get("/api/health", async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "sağlık kontrolü: veritabanı yanıt vermedi");
      res.status(503).json({ ok: false });
    }
  });

  // Yüklenen ürün görselleri herkese açık (Meta çeker). Dosya adları rastgele ek içerir, listeleme kapalı.
  app.use("/uploads", express.static(path.resolve(env.uploadDir), { index: false, dotfiles: "deny", maxAge: "30d", immutable: true }));

  // WAHA webhook: oturum çerezi yok, HMAC imzasıyla doğrulanır (auth'tan ÖNCE bağlanmalı)
  // Yeni siparişte müşteriye "siparişinizi aldık" mesajı (hata sipariş kaydını etkilemez)
  const cloudForAck = env.whatsappCloud?.token ? new WhatsappCloudClient(env.whatsappCloud) : null;
  app.use(
    "/api/webhooks",
    webhooksRouter(db, env, {
      // Yeni sepet: ödeme şeklini sor (hata sipariş kaydını etkilemez)
      onOrderCreated: (orderId) => void startOrderConversation(db, cloudForAck, orderId),
      // Müşteri yazdı: bekleyen siparişin ödeme/adres adımını işle, yoksa uzun süre sonra ilk mesajsa hoş geldin gönder
      onInbound: (i) =>
        void handleOrderReply(db, cloudForAck, i.brand, i.customer, i.message, i.raw).then(() => sendWelcomeIfNeeded(db, cloudForAck, i.brand, i.customer, i.message)),
    }),
  );

  app.use("/api/public", publicRouter(db));

  app.use(requireAuth(env.sessionSecret));
  app.use("/api/auth", authRouter(env));

  await bootstrapBrands(db, env);
  await ensureDefaultChannels(db);
  await ensureDefaultPaymentTypes(db);
  const coordinator = new SyncCoordinator(db, env.meta, env.publicBaseUrl, env.metaAutoSync);
  const onChange = (brandId: number) => coordinator.trigger(brandId);
  // Alan adı değiştiyse katalogdaki görsel adresleri yenilenir (arka planda, açılışı geciktirmez)
  void handlePublicUrlChange(db, env.publicBaseUrl)
    .then((brandIds) => {
      for (const id of brandIds) {
        logger.info({ brandId: id }, "Herkese açık adres değişti: katalog yeniden gönderiliyor");
        coordinator.run(id).catch((err: Error) => logger.warn({ err: err.message, brandId: id }, "adres değişimi sonrası katalog gönderimi başarısız (Ürünler sayfasından 'Meta'ya gönder')"));
      }
    })
    .catch((err) => logger.error({ err }, "adres değişimi denetlenemedi"));
  app.use("/api/brands", brandsRouter(db));
  app.use("/api/products", imagesRouter(db, env.uploadDir, onChange));
  app.use("/api/products", productsRouter(db, onChange));
  app.use("/api/categories", categoriesRouter(db, onChange));
  app.use("/api/meta", metaRouter(db, coordinator));
  const cloudClient = env.whatsappCloud?.token ? new WhatsappCloudClient(env.whatsappCloud) : null;
  app.use("/api/whatsapp", whatsappRouter(db, env, env.waha ? new WahaClient(env.waha) : null, cloudClient));
  app.use("/api/orders", ordersRouter(db, cloudClient, env.publicBaseUrl));
  app.use("/api/sound", soundRouter(db, env.uploadDir));
  app.use("/api/messages", messagesRouter(db));
  app.use("/api/chat", chatRouter(db, cloudClient));
  app.use("/api/channels", channelsRouter(db, env.publicBaseUrl));
  app.use("/api/payments", paymentsRouter(db));
  app.use("/api/ratings", ratingsRouter(db));
  app.use("/api/customers", customersRouter(db));

  // Süresi dolan "bugün tükendi" işaretlerini temizle (sabah ürünler otomatik geri açılır)
  const expiryTimer = setInterval(() => {
    refreshExpiredSoldOut(db, new Date())
      .then((brandIds) => {
        if (brandIds.length > 0) {
          logger.info(`"Bugün tükendi" işaretleri kaldırıldı (marka: ${brandIds.join(", ")})`);
          for (const id of brandIds) coordinator.trigger(id);
        }
      })
      .catch((err) => logger.error({ err }, "tükendi işareti temizlenemedi"));
  }, 60_000);
  // Kişisel veri içeren ham webhook olaylarını 14 gün sonra sil (açılışta ve saatte bir)
  const purge = () => purgeOldWebhookEvents(db).then((n) => n > 0 && logger.info(`${n} eski webhook olayı silindi`)).catch((err) => logger.error({ err }, "eski olaylar silinemedi"));
  void purge();
  const purgeTimer = setInterval(purge, 60 * 60 * 1000);
  logger.info(`WhatsApp (WAHA): ${env.waha ? "ayarlı" : "kapalı (WAHA ayarları eksik)"} | Cloud API: ${env.whatsappCloud ? (env.whatsappCloud.token ? "webhook + gönderim" : "yalnızca webhook (jeton yok)") : "kapalı"}`);
  logger.info(`Meta eşitleme: ${env.meta ? (env.metaAutoSync ? "açık, otomatik" : "açık, elle") : "kapalı (Meta ayarları eksik)"}`);

  app.all("*", (req, res) => handle(req, res));

  const server = app.listen(env.port, () => {
    logger.info(`tndrWA http://localhost:${env.port} (${env.nodeEnv}) üzerinde çalışıyor`);
  });

  const shutdown = () => {
    clearInterval(expiryTimer);
    clearInterval(purgeTimer);
    coordinator.stop();
    server.close(() => {
      db.$disconnect().finally(() => process.exit(0));
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
