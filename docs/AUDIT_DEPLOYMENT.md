# Audit fix deployment notes

This file records deployment prerequisites and local verification. Deployment and live payment actions are outside the fix plan.

## Before deploying

1. Set `CLERK_ISSUER_URL` to the exact trusted Clerk session issuer for the deployed instance. Customer/admin authentication fails closed when it is missing or invalid.
2. Back up the database. Pause new checkout traffic during rollout. Resolve or expire all pre-reservation pending Stripe sessions before new reserved checkouts begin: old sessions did not hold stock and can otherwise compete with new orders. Complete paid legacy orders or refund/reconcile them using authoritative Stripe records.
3. Restore any seeded listings/inventory that older startup code overwrote, using verified records or backups. The new seed routine preserves data but cannot reconstruct lost edits.
4. Run `npm run db:generate`, build, then `npm run db:migrate` before starting the updated API. The reservation migration defaults historical orders to unreserved; the receipt migration leaves historical guest credentials empty.
5. Deploy API and frontend together. Old frontends do not retain guest receipt credentials, and old order-ID-only receipt links intentionally stop granting access. Customers can sign in with the order email; support/admin access remains available.

## Reservation operations

`Product.inventory` is available stock after reservations. Expire the Stripe session before releasing a pending order's stock; do not directly change an order status in the database. New sessions expire after 35 minutes. The API worker runs cleanup at startup and every minute. Delayed payments remain reserved while processing.

Stripe timeouts or server errors do not prove that session creation failed. Recovery repeats the persisted request with its stable idempotency key. If an unrecorded session is older than 23 hours, automatic recovery stops and reports the order ID for manual Stripe reconciliation. Find the original session by its `metadata.orderId`, determine whether it paid, and expire it before restoring stock if unpaid. Keep the reservation until that evidence is available.

## Local database verification

The PostgreSQL integration suite is opt-in with `TEST_DATABASE_URL`. It accepts only localhost database names ending in `_audit`, never falls back to `DATABASE_URL`, and deletes only its own generated fixtures. Apply migrations to an isolated test database before running it. Without `TEST_DATABASE_URL`, the integration suite skips explicitly.

An isolated PostgreSQL 15 cluster under `.app-data/audit-postgres-20260930` on `127.0.0.1:55439` was used for these checks. All migrations through `20261001030000_refund_ledger` applied successfully. Concurrency, stock rollback, payment/cancellation races, seed preservation, receipt-hash persistence, notification leases, refund replay, and historical reconciliation are tested against the actual Prisma adapter.

## After deployment

Verify Clerk sign-in/admin access; Stripe test-mode payment, delayed-payment success/failure where enabled, expiry, cancellation, and refunds; guest receipts returning in the checkout tab; signed-in legacy receipt access; and Resend notifications. Local tests use synthetic data and do not prove live provider configuration.
## Refund verification

Configured Stripe refund webhooks and admin refund results retrieve the current refund from Stripe while holding the order's database row lock. This serializes retrieval and ledger persistence across API processes. Session metadata, payment intent, refund ID, and refund metadata are checked against the order before mutation. Retrieval failures leave the ledger unchanged and require retry. Canceled refunds count as failed; pending/requires-action refunds do not count toward refunded money. `charge.refunded` is not interpreted as an individual refund; subscribe to `refund.created`, `refund.updated`, and `refund.failed`.

## Historical refund reconciliation

Apply `20261001030000_refund_ledger` before deploying the ledger code. It marks orders with prior refund data as requiring reconciliation. These orders cannot create another refund or accept ledger changes until reconciled.

An authenticated administrator can POST `/api/admin/orders/:orderId/reconcile-refunds` with no body. The endpoint verifies any stored Checkout Session's order metadata/payment intent, iterates all refunds for the bound payment intent, and replaces the historical ledger in a single transaction. Unknown statuses, mismatched ownership, duplicate IDs, or excessive totals reject the operation. It does not create refunds or send historical refund emails. The reconciliation flag is cleared only after successful persistence. Stripe configuration and payment identifiers are required; orders missing these identifiers need manual investigation before attempting reconciliation.

The resulting status reflects the refund ledger. An empty ledger produces `paid`; historical fulfillment cannot be reconstructed from a status overwritten by refunds, so verify shipping records separately. Retry is deliberately rejected once the historical reconciliation flag is cleared, preventing an older snapshot from replacing newly processed ledger updates.

## Payment and refund notification outbox

Apply `20261001020000_payment_notifications` before deploying the updated API. New payment/refund transitions save notification jobs in the same transaction as their state. Existing paid orders and reconciled historical refunds are not backfilled because their delivery history is unknown. Startup/minute processing retries unfinished jobs independently of Stripe webhook delivery. Concurrent workers use a one-minute lease; paid customer and owner messages use separate stable Resend idempotency keys, and refund notifications use a key for each refund ID and result.

Resend retains idempotency keys for 24 hours ([provider documentation](https://resend.com/docs/dashboard/emails/idempotency-keys)). Automatic attempts stop 23 hours after the first attempt; an unsent job then requires manual reconciliation with provider delivery records. Do not delete/reset its first-attempt timestamp or resend blindly. A lost acknowledgement can mean the provider already accepted the message. Keep sender, recipients, and templates stable while retrying these jobs; changing parameters under the same key can produce a provider conflict that requires review. Unconfigured email remains disabled as before; jobs processed while email is disabled are consumed rather than sent retroactively.

