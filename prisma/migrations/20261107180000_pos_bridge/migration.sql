-- AlterTable
ALTER TABLE "Brand" ADD COLUMN "posCafeId" TEXT;

-- AlterTable
ALTER TABLE "OptionChoice" ADD COLUMN "posName" TEXT;

-- AlterTable
ALTER TABLE "OptionGroup" ADD COLUMN "posName" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "posAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "posRef" TEXT;

-- CreateTable
CREATE TABLE "PosSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "brandId" INTEGER NOT NULL,
    "cafeId" TEXT NOT NULL,
    "cafeName" TEXT NOT NULL DEFAULT '',
    "data" TEXT NOT NULL,
    "productCount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PosSnapshot_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PosSnapshot_brandId_createdAt_idx" ON "PosSnapshot"("brandId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_posCafeId_key" ON "Brand"("posCafeId");

