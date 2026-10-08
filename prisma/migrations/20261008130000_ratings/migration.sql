-- AlterTable
ALTER TABLE "Order" ADD COLUMN "ratingToken" TEXT;

-- CreateTable
CREATE TABLE "Rating" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "brandId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "customerId" INTEGER,
    "taste" INTEGER NOT NULL,
    "care" INTEGER NOT NULL,
    "delivery" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "name" TEXT,
    "phone" TEXT,
    "low" BOOLEAN NOT NULL DEFAULT false,
    "followUp" TEXT NOT NULL DEFAULT 'NONE',
    "followNote" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Rating_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Rating_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Rating_orderId_key" ON "Rating"("orderId");

-- CreateIndex
CREATE INDEX "Rating_brandId_createdAt_idx" ON "Rating"("brandId", "createdAt");

-- CreateIndex
CREATE INDEX "Rating_brandId_low_followUp_idx" ON "Rating"("brandId", "low", "followUp");

-- CreateIndex
CREATE UNIQUE INDEX "Order_ratingToken_key" ON "Order"("ratingToken");


-- Açılış sayfasındaki "Bizi değerlendirin" butonu dahili değerlendirme sayfasına gider; varsayılan olarak açık
UPDATE "BrandChannel" SET "enabled" = 1 WHERE "kind" = 'REVIEW';
