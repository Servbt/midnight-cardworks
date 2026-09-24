-- Receipt links are bearer capabilities for the order page (which includes the shipping
-- address), so they must not be valid forever. Existing rows keep a null expiry and are
-- treated as unexpired by application code; only orders created after this migration
-- receive an explicit expiry.
ALTER TABLE "Order" ADD COLUMN "receiptExpiresAt" TIMESTAMP(3);
