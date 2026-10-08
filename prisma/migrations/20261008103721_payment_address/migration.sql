-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "address" TEXT;
ALTER TABLE "Customer" ADD COLUMN "lat" REAL;
ALTER TABLE "Customer" ADD COLUMN "lng" REAL;

-- CreateTable
CREATE TABLE "PaymentType" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "brandId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PaymentType_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "brandId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "waMessageId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "note" TEXT NOT NULL DEFAULT '',
    "totalKurus" INTEGER NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'READY',
    "paymentTypeId" INTEGER,
    "paymentLabel" TEXT NOT NULL DEFAULT '',
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "discountKurus" INTEGER NOT NULL DEFAULT 0,
    "address" TEXT NOT NULL DEFAULT '',
    "lat" REAL,
    "lng" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("brandId", "createdAt", "customerId", "id", "note", "status", "totalKurus", "updatedAt", "waMessageId") SELECT "brandId", "createdAt", "customerId", "id", "note", "status", "totalKurus", "updatedAt", "waMessageId" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_waMessageId_key" ON "Order"("waMessageId");
CREATE INDEX "Order_brandId_status_idx" ON "Order"("brandId", "status");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PaymentType_brandId_name_key" ON "PaymentType"("brandId", "name");
