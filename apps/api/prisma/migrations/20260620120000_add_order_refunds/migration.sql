ALTER TYPE "OrderStatus" ADD VALUE 'canceled';
ALTER TYPE "OrderStatus" ADD VALUE 'refund_pending';
ALTER TYPE "OrderStatus" ADD VALUE 'partially_refunded';
ALTER TYPE "OrderStatus" ADD VALUE 'refunded';
ALTER TYPE "OrderStatus" ADD VALUE 'refund_failed';

ALTER TABLE "Order" ADD COLUMN "stripeSessionId" TEXT;
ALTER TABLE "Order" ADD COLUMN "stripePaymentIntentId" TEXT;
ALTER TABLE "Order" ADD COLUMN "stripeRefundId" TEXT;
ALTER TABLE "Order" ADD COLUMN "refundedAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "refundReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "canceledAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "refundedAt" TIMESTAMP(3);
