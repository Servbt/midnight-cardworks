ALTER TABLE "Order" ADD COLUMN "refundReconciliationRequired" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Order" SET "refundReconciliationRequired" = true
WHERE "refundedAmount" <> 0 OR "stripeRefundId" IS NOT NULL
OR "status" IN ('refund_pending', 'partially_refunded', 'refunded', 'refund_failed');
CREATE TABLE "OrderRefund" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "amount" INTEGER NOT NULL CHECK ("amount" >= 0),
  "status" TEXT NOT NULL CHECK ("status" IN ('pending', 'succeeded', 'failed')),
  "reason" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "OrderRefund_orderId_idx" ON "OrderRefund"("orderId");
