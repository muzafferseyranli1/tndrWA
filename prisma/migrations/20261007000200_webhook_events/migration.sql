-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" TEXT,
    "session" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "messageType" TEXT,
    "body" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_requestId_key" ON "WebhookEvent"("requestId");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_session_event_idx" ON "WebhookEvent"("session", "event");

-- Markaların WAHA oturum adları (oturum adı marka koduyla aynı)
UPDATE "Brand" SET "waSession" = "code" WHERE "waSession" IS NULL;
