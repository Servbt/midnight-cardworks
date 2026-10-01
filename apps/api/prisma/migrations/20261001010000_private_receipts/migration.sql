-- Older order IDs are not receipt credentials. Legacy guests must authenticate
-- with the order email or contact support; never backfill a predictable token.
ALTER TABLE "Order" ADD COLUMN "receiptTokenHash" TEXT;
