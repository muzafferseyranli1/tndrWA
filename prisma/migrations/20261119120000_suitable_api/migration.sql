-- Suitable Dış Kaynak API: siparişin API'deki kimliği ve yazma denemesi durumu
ALTER TABLE "Order" ADD COLUMN "suitableId" TEXT;
ALTER TABLE "Order" ADD COLUMN "suitableTries" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "suitableNextAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "suitableError" TEXT;
