-- CreateTable
CREATE TABLE "BrandChannel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "brandId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BrandChannel_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Hit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "brandId" INTEGER,
    "event" TEXT NOT NULL,
    "kind" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandChannel_brandId_kind_key" ON "BrandChannel"("brandId", "kind");

-- CreateIndex
CREATE INDEX "Hit_createdAt_idx" ON "Hit"("createdAt");

-- CreateIndex
CREATE INDEX "Hit_brandId_event_kind_idx" ON "Hit"("brandId", "event", "kind");
