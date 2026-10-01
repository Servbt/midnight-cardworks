-- Historical orders have not reserved inventory. Do not claim or subtract it retroactively.
ALTER TABLE "Order" ADD COLUMN "inventoryReserved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "reservationExpiresAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "checkoutRequestJson" TEXT;
CREATE INDEX "Order_status_reservationExpiresAt_idx" ON "Order"("status", "reservationExpiresAt");
