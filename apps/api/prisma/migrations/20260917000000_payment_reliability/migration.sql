ALTER TABLE "Order" ADD COLUMN "discountAmount" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "paidAt" TIMESTAMP(3), ADD COLUMN "fulfilledAt" TIMESTAMP(3);
UPDATE "Order" SET "paidAt" = "createdAt" WHERE "status" IN ('paid', 'fulfilled', 'refund_pending', 'partially_refunded', 'refunded', 'refund_failed');
UPDATE "Order" SET "fulfilledAt" = "updatedAt" WHERE "status" = 'fulfilled';
CREATE TABLE "PaymentJournal" (
 "id" TEXT NOT NULL PRIMARY KEY, "kind" TEXT NOT NULL, "orderId" TEXT,
 "data" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "PaymentJournal_kind_orderId_idx" ON "PaymentJournal"("kind", "orderId");
-- Preserve historical aggregate refunds without counting a known latest ID again.
INSERT INTO "PaymentJournal" ("id", "kind", "orderId", "data", "updatedAt")
SELECT 'refund-baseline:' || "id", 'refund-baseline', "id",
 jsonb_build_object('amount', "refundedAmount", 'lastRefundId', "stripeRefundId", 'migratedAt', EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000), CURRENT_TIMESTAMP
FROM "Order" WHERE "refundedAmount" > 0;
