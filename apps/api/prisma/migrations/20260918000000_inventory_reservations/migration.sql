ALTER TABLE "Product" ADD COLUMN "reservedInventory" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "inventoryVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD CONSTRAINT "Product_inventory_nonnegative" CHECK ("inventory" >= 0),
 ADD CONSTRAINT "Product_reservedInventory_nonnegative" CHECK ("reservedInventory" >= 0);
ALTER TABLE "Order" ADD COLUMN "inventoryState" TEXT NOT NULL DEFAULT 'legacy',
 ADD COLUMN "reservationExpiresAt" TIMESTAMP(3), ADD COLUMN "inventoryIssue" TEXT;
-- Existing paid orders were already deducted by phase 3. Preserve pending commitments,
-- even when an old checkout had overbooked stock; new reservations see zero available.
UPDATE "Order" SET "inventoryState" = 'consumed' WHERE "paidAt" IS NOT NULL;
UPDATE "Order" SET "inventoryState" = 'legacy_held',
 "reservationExpiresAt" = "createdAt" + INTERVAL '24 hours'
 WHERE "status" = 'pending_payment' AND "paidAt" IS NULL;
UPDATE "Product" p SET "reservedInventory" = r.quantity FROM (
 SELECT i."productId", SUM(i.quantity)::INTEGER AS quantity FROM "OrderItem" i
 JOIN "Order" o ON o.id = i."orderId" WHERE o."inventoryState" = 'legacy_held'
 GROUP BY i."productId"
) r WHERE p.id = r."productId";
CREATE INDEX "Order_inventoryState_reservationExpiresAt_idx" ON "Order"("inventoryState", "reservationExpiresAt");
