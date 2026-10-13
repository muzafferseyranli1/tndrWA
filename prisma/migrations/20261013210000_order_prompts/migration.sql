-- Yanıt bekleme: son soru zamanı ve hatırlatma zamanı
ALTER TABLE "Order" ADD COLUMN "promptedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "reminderSentAt" DATETIME;
