# Payment reliability (phase 3)

This change covers order transitions, durable Stripe event/refund records, final
Checkout amounts and discounts, retry-safe checkout/refund requests, cancellation
races, and durable order notifications. Inventory reservation and overselling
prevention remain phase 4; inventory is still decremented when payment is confirmed.

## Before deploying

1. Keep Render's build command as `npm ci --include=dev && npm run render:build`.
   Keep **Pre-Deploy Command** as `npm run db:migrate` and **Start Command** as
   `npm run start`. This release adds migration
   `20260917000000_payment_reliability`. Do not run migrations during the build.
2. In the existing Stripe webhook destination, enable all of:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `refund.created`
   - `refund.updated`
   - `refund.failed`
   - `charge.refunded`
   The URL stays `/api/stripe/webhook`; keep the signing secret for that destination.
3. Confirm the existing `RESEND_API_KEY`, `EMAIL_FROM`, and
   `ORDER_NOTIFICATION_EMAIL` (or `ADMIN_EMAILS` fallback) are configured. No new
   environment secrets are required. Missing email configuration retains jobs
   for later delivery instead of silently discarding them.
4. Deploy backend and web assets together. Checkout and refund POST requests now
   require a random `Idempotency-Key` header. Old open browser tabs receive a
   refresh instruction. The current web client supplies and remembers retry keys.
5. Use Stripe test mode in a staging service to rehearse a discounted purchase,
   delayed payment, two partial refunds, event replays, and cancellation before
   exposing the release to live orders. Automated tests use mocks and an isolated
   local PostgreSQL database; they do not charge cards or send email.

## State and transaction guarantees

- Payment confirmation requires a completed Checkout Session that is paid, or a
  completed zero-total payment with `no_payment_required`. Unpaid completion stays
  pending until the delayed-payment success/failure event arrives.
- Stripe session identity, USD currency, quoted subtotal, discount and final total
  must reconcile. Shipping remains the existing shipping line item. Stripe Tax
  and separate Stripe shipping options are not enabled by this release.
- A payment cannot revert fulfilled/refunded states. Verified late payment wins
  over earlier cancellation/failure. `paidAt` prevents a second inventory decrement.
- Fulfillment requires a paid or partially refunded order; cancellation requires
  an unpaid order. Stripe Checkout is expired first. Completed payments are
  reconciled, and completed-but-processing sessions cannot be canceled locally.
- Each Stripe event ID, individual refund ID, request operation and notification
  has a unique, prefix-qualified ID in `PaymentJournal`. A short PostgreSQL advisory
  transaction lock serializes payment mutations across instances. No Stripe or
  email network request runs inside this lock.
- Event deduplication, order/inventory changes and notification creation commit
  together. A persistence failure rolls back all of them and returns HTTP 503 so
  Stripe retries. Invalid signatures return HTTP 400.
- Refunds are counted by individual ID, never by adding `charge.refunded` aggregate
  amounts. Current Stripe refund state is retrieved before applying old events;
  pending events cannot undo success, and failure can remove a previously successful
  refund from the total. Full refunds use the server's current captured balance.
- New refund requests reconcile Stripe's current refund list first. An unresolved
  request blocks another request for that order; retry uses the same frozen amount,
  reason and Stripe idempotency key. Pending refunds also block another request.

## Existing orders

The additive migration backfills payment/fulfillment timestamps and preserves old
refund aggregates. The first refund reconciliation imports the complete paginated
Stripe refund history, replacing the old aggregate without counting it twice.
Historical refund receipts are not resent. Legacy paid orders can have their final
Stripe totals corrected without another inventory decrement or confirmation email.

The new code also recognizes paid statuses written by the old deployment between
migration and deployment. Avoid rolling back to the old payment handler while
accepting orders: it does not maintain the journal. A rollback preserves the new
tables, but requires reconciliation of payments/refunds made by the old version
before returning to this release. Historical canceled orders that actually captured
payment under an older race condition need an inventory review: old data cannot
prove whether their inventory was already decremented.

## Email delivery and recovery

The API saves order notification intents atomically with transitions. The process
in `apps/api/src/index.ts` starts a worker every 10 seconds. It renders and persists
separate customer/admin payloads, claims 60-second delivery leases, and retries
with exponential backoff and stable Resend idempotency keys. Recipient configuration
and message bodies remain frozen after rendering. A restart resumes unfinished jobs.
Stale cancellation, pending-checkout and reversed-refund messages are suppressed
before sending. Contact/newsletter/campaign email behavior is unchanged.

Stripe and Resend do not provide permanent provider-side deduplication. Unfinished
Stripe operations and ambiguous email deliveries stop automatic retry after
**23 hours**, before the documented 24-hour retention window ends. They remain
recorded for reconciliation; a retry after that point does not create a new request.

Authenticated admins can inspect `GET /api/admin/payment-health` using their existing
admin bearer token. It returns pending/attention notification IDs and unresolved
checkout/refund operation IDs, without email payloads or receipt credentials.

Recovery procedure:

1. For a recent network failure, retry the same action with unchanged details in
   the same browser. Its saved key survives a reload. Do not clear site storage
   while resolving an ambiguous refund.
2. For an operation older than 23 hours, inspect the matching Stripe request logs
   by the journal operation ID (also the Stripe idempotency key), and the order's
   Checkout Session/PaymentIntent and refund history. Replay the relevant Stripe
   event or use Sync payment to reconcile the order. Do not submit a new refund
   until the original operation's outcome is established.
3. For a notification in `attention`, inspect Resend delivery logs for its exact
   idempotency key. A maintainer must record a confirmed delivery as sent, or arrange
   an explicitly reconciled new delivery if the original was not accepted. Do not
   reset `firstAttemptAt` or delete records just to force a retry: that can duplicate mail.
4. Resolving a stranded operation requires a maintainer to record its confirmed
   Stripe outcome in the journal transaction. There is intentionally no automatic
   deletion or blind retry of an ambiguous payment. Keep journal IDs for replay safety.

Provider references:

- [Checkout fulfillment and delayed payments](https://docs.stripe.com/checkout/fulfillment)
- [Expire Checkout](https://docs.stripe.com/api/checkout/sessions/expire)
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)

## Verification

Run `npm run test`, `npm run typecheck`, and `npm run render:build`.
For database integration tests, create a dedicated local PostgreSQL database named
`midnight_payment_test`, apply all migrations there, then set `TEST_DATABASE_URL`
to that database and run the API suite. The tests refuse non-loopback hosts or a
different database name, and erase only this dedicated test database's shop tables.

Coverage includes concurrent independent database clients, reconnect/replay,
transaction rollback on outbox failure, legacy migration fixtures, discounted and
zero-total checkout, delayed success/failure, refund reordering, paginated Stripe
history, cancellation races, changed request details, lost responses, email worker
crashes/leases, provider retry limits, and browser receipt/retry behavior.

Verified locally on 2026-09-17: 112 API tests (including 5 real PostgreSQL tests),
84 web tests, both TypeScript checks, and the Render production build passed.
All nine migrations applied to an isolated PostgreSQL 15 database; the upgrade
fixture also verified historical paid/fulfilled/refunded rows. No production
configuration, payment, email delivery, merge or deployment was performed.
