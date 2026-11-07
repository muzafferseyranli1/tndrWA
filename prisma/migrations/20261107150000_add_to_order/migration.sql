-- Açık siparişe WhatsApp'tan ürün ekleme
ALTER TABLE "Order" ADD COLUMN "addedPending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "mergeIntoId" INTEGER;
ALTER TABLE "OrderItem" ADD COLUMN "addedAt" DATETIME;
