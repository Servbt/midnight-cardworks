CREATE TABLE "OrderNotification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "payloadJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "firstAttemptAt" TIMESTAMP(3),
  "leaseUntil" TIMESTAMP(3),
  "leaseToken" TEXT,
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT
);
CREATE INDEX "OrderNotification_sentAt_leaseUntil_idx" ON "OrderNotification"("sentAt", "leaseUntil");
-- Existing paid orders are not backfilled because delivery history is unknown.
