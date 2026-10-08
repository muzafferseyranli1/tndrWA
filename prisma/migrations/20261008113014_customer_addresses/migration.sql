-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "lat" REAL,
    "lng" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAddress_customerId_key_key" ON "CustomerAddress"("customerId", "key");

-- Müşterinin eski tek adresini yeni adres listesine taşı
INSERT INTO "CustomerAddress" ("customerId", "text", "key", "lat", "lng", "createdAt", "lastUsedAt")
SELECT "id", "address", lower(trim("address")), "lat", "lng", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Customer" WHERE "address" IS NOT NULL AND trim("address") <> '';
