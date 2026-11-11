-- Telegram kanalı: müşteri Telegram kimliği, mesaj ve siparişin kanalı
ALTER TABLE "Customer" ADD COLUMN "tgId" TEXT;
CREATE UNIQUE INDEX "Customer_tgId_key" ON "Customer"("tgId");
ALTER TABLE "Message" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE "Order" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'whatsapp';
