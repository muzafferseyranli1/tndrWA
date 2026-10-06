-- CreateTable
CREATE TABLE "Brand" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metaCatalogId" TEXT,
    "waSession" TEXT
);

-- Mevcut tüm kategori ve ürünler 1 numaralı markaya (Yerinde Tandır) bağlanır; ikinci marka boş başlar.
INSERT INTO "Brand" ("id", "code", "name", "sortOrder") VALUES (1, 'tandir', 'Yerinde Tandır', 0), (2, 'pide', 'Yerinde Pide', 1);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Category" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "brandId" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Category_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Category" ("id", "name", "sortOrder") SELECT "id", "name", "sortOrder" FROM "Category";
DROP TABLE "Category";
ALTER TABLE "new_Category" RENAME TO "Category";
CREATE UNIQUE INDEX "Category_brandId_name_key" ON "Category"("brandId", "name");
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "brandId" INTEGER NOT NULL DEFAULT 1,
    "retailerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupKey" TEXT,
    "variantLabel" TEXT,
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
    CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("categoryId", "createdAt", "description", "id", "imagePath", "metaError", "metaId", "metaSyncState", "metaSyncedAt", "name", "onMeta", "priceKurus", "retailerId", "soldOutUntil", "sortOrder", "status", "updatedAt") SELECT "categoryId", "createdAt", "description", "id", "imagePath", "metaError", "metaId", "metaSyncState", "metaSyncedAt", "name", "onMeta", "priceKurus", "retailerId", "soldOutUntil", "sortOrder", "status", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX "Product_brandId_groupKey_idx" ON "Product"("brandId", "groupKey");
CREATE UNIQUE INDEX "Product_brandId_retailerId_key" ON "Product"("brandId", "retailerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Brand_code_key" ON "Brand"("code");
