-- CreateTable
CREATE TABLE "OrderChange" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "orderId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderChange_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "ratingToken" TEXT,
    "noticePending" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("address", "brandId", "createdAt", "customerId", "discountKurus", "discountPercent", "id", "lat", "lng", "note", "paymentLabel", "paymentTypeId", "ratingToken", "stage", "status", "totalKurus", "updatedAt", "waMessageId") SELECT "address", "brandId", "createdAt", "customerId", "discountKurus", "discountPercent", "id", "lat", "lng", "note", "paymentLabel", "paymentTypeId", "ratingToken", "stage", "status", "totalKurus", "updatedAt", "waMessageId" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_waMessageId_key" ON "Order"("waMessageId");
CREATE UNIQUE INDEX "Order_ratingToken_key" ON "Order"("ratingToken");
CREATE INDEX "Order_brandId_status_idx" ON "Order"("brandId", "status");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "OrderChange_orderId_createdAt_idx" ON "OrderChange"("orderId", "createdAt");

