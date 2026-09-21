# Inventory reservations (phase 4)

## Behavior

- A new checkout reserves all cart items in one database transaction before Stripe
  is called. Duplicate product lines are combined; unavailable, inactive or
  insufficient stock rejects the entire cart without a partial reservation.
- Physical inventory includes units held by unpaid checkouts. Available inventory
  is `max(0, inventory - reservedInventory)`. Public product responses and SEO show
  available stock; the admin editor shows physical, held and available stock.
- New Stripe sessions have a fixed one-hour expiration. A successful payment
  consumes the physical stock and its hold once. Confirmed expiration or an admin
  cancellation releases the hold once. The Stripe back button alone does not
  release it: the session may still accept payment.
- Refunds do not restock physical goods. After checking whether goods were shipped
  or returned, an admin can deliberately increase physical stock.
- Stock edits carry an inventory version. If checkout activity changed stock
  since the editor loaded, saving returns HTTP 409. Reload the dashboard, review
  the latest physical/held values and reapply the intended change.
- A verified late payment is recorded even if its hold was released. If remaining
  available stock cannot cover it, the order gets an inventory issue and cannot
  be fulfilled. Its receipt and paid notification explain the stock review.
  Replenish physical stock and use **Sync Stripe payment**, or refund the payment.
  Allocation never takes units reserved by another checkout.

## Before deploying

This is an application-and-database change. No new secrets or webhook event types
are needed beyond phase three's eight events (including Checkout expiration and
asynchronous payment success/failure). See [payment reliability](PAYMENT_RELIABILITY.md).

1. Rehearse in a separate staging service with Stripe test credentials. Verify a
   database backup/restore point before applying the production migration.
2. Arrange a brief maintenance window that blocks checkout, admin inventory/order
   mutations, and Stripe webhook deliveries to the old version on every public
   origin. Drain in-flight requests before running the migration. Stripe deliveries
   blocked during the window must be retried afterward. Do not leave another old
   replica or external writer accepting stock mutations during this handoff.
3. Keep the build command `npm ci --include=dev && npm run render:build` and the
   pre-deploy command `npm run db:migrate`. The migration
   `20260918000000_inventory_reservations` adds counters, nonnegative constraints,
   order reservation fields, and an index. Confirm it succeeds before starting
   the new version. Deploy API and web assets from the same commit.
4. Confirm only the new version serves traffic before ending maintenance. Verify
   `/health`, then reload admin browser tabs so they send the new stock version.
   Inspect held quantities and pending orders before reopening checkout.
5. Run the staging checks below, then check production health and Stripe delivery
   status. Do not treat a successful build as proof of live payment behavior.

The migration reserves every existing pending order, combining duplicate lines.
Historical commitments can exceed physical stock: available becomes zero until
those sessions are reconciled. Existing paid orders are marked consumed without
another stock deduction. A compatibility check cleans up migrated holds if an old
writer already recorded payment, but does not make mixed-version stock writes safe.
Historical data cannot prove whether older canceled-but-paid orders were already
stock-deducted; review those manually.

Do not roll back to phase-three code while accepting orders: it ignores reservation
counters. If rollback is necessary, keep writes paused, retain the additive schema,
reconcile Stripe outcomes and physical/held stock, and fix forward or plan an
explicit data reconciliation before reopening.

## Recovery and operations

The API runs a recovery pass at startup and every minute. The deadline triggers a
Stripe check, not an unconditional release. Open sessions are expired; paid sessions
are reconciled; completed payments still processing keep their holds. A completed
session with a canceled or failed PaymentIntent can release its hold. Network and
provider errors retain stock for retry.

If checkout creation reached Stripe but its response was lost, recovery enumerates
all pages of sessions in the order's creation window and matches order metadata.
With no matching session, new holds release after their fixed deadline plus five
minutes. Legacy holds without a session ID wait 48 hours plus five minutes from
creation, covering the old retry and session lifetime windows. These conservative
holds can temporarily reduce availability; never reset counters merely because a
local deadline has passed.

Authenticated `GET /api/admin/payment-health` adds:

- `inventoryHolds`: order IDs, state and deadline for outstanding holds.
- `inventoryIssues`: paid orders that need allocation or refund before fulfillment.
- `inventoryRecovery`: order IDs whose last recovery attempt failed. Check the
  current order as well; a webhook can resolve it after that recorded attempt.

For an unexpected hold, inspect its Stripe session and payment status first. Use
admin cancellation to expire an open session, or **Sync Stripe payment** for a paid
one. Unresolved creation without a saved session ID is intentionally protected from
manual cancellation; allow recovery to find it. Recovery survives restarts because
orders and counters are persisted. Duplicate workers may perform provider reads,
but database transitions remain serialized and idempotent.

## Verification

Automated coverage includes last-unit contention across independent PostgreSQL
connections, whole-cart rollback, duplicate quantities, stale stock edits, payment
and expiration races, lost responses, pagination, processing/failure behavior,
refunds without restocking, late-payment fulfillment holds, and legacy migration.

Verified locally on 2026-09-20: 130 API tests (including eight PostgreSQL tests),
86 web tests, both workspace typechecks, and `npm run render:build` passed.
The additive migration was applied successfully to the isolated test database.

Local integration tests require a disposable PostgreSQL database named
`midnight_payment_test` on `127.0.0.1` or `localhost`. They erase its shop tables.
Set `DATABASE_URL` to that database for `npm run db:migrate`, then set
`TEST_DATABASE_URL` to the same URL for `npm run test`. Without that variable,
database integration tests are skipped. Also run `npm run typecheck` and
`npm run render:build`.

Before live rollout, rehearse on staging:

1. Give a test product one unit; start checkout in two independent browser sessions.
   Only one can proceed, and available stock becomes zero while physical stays one.
2. Pay the first session. Physical and held stock become zero; replay its Stripe
   event and confirm neither changes again.
3. With another test unit, cancel via the admin action or let Checkout expire.
   Verify the hold releases and another buyer can reserve it.
4. Exercise a delayed payment: processing must retain its hold, success consumes
   it, and confirmed failure releases it. Restart the service during an unpaid
   hold and verify recovery still works.
5. Refund a paid order and confirm physical stock does not increase. Try saving
   a product editor opened before a reservation and confirm it requests a refresh.

These staging and production checks are deployment gates for the store owner;
automated local tests do not charge cards, send real email, or verify live settings.
