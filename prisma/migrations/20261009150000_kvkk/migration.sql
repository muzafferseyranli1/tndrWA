-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "noticeSentAt" DATETIME;

-- CreateTable
CREATE TABLE "DeletionRequest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "phone" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "handledAt" DATETIME,
    "handledNote" TEXT NOT NULL DEFAULT ''
);

-- CreateIndex
CREATE INDEX "DeletionRequest_status_createdAt_idx" ON "DeletionRequest"("status", "createdAt");

