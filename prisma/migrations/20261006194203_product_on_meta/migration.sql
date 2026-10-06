-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "retailerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priceKurus" INTEGER NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "imagePath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "soldOutUntil" DATETIME,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metaId" TEXT,
    "onMeta" BOOLEAN NOT NULL DEFAULT false,
    "metaSyncState" TEXT NOT NULL DEFAULT 'PENDING',
    "metaError" TEXT,
    "metaSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("categoryId", "createdAt", "description", "id", "imagePath", "metaError", "metaId", "metaSyncState", "metaSyncedAt", "name", "priceKurus", "retailerId", "soldOutUntil", "sortOrder", "status", "updatedAt") SELECT "categoryId", "createdAt", "description", "id", "imagePath", "metaError", "metaId", "metaSyncState", "metaSyncedAt", "name", "priceKurus", "retailerId", "soldOutUntil", "sortOrder", "status", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_retailerId_key" ON "Product"("retailerId");
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
