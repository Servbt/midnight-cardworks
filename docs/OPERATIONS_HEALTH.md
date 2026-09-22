# Operational health and recovery (phase 5)

## Admin dashboard

Open **Admin dashboard > Health** after deploying this branch. The API route
`GET /api/admin/operations-health` requires the existing server-side admin allowlist
and returns `Cache-Control: no-store`. The page loads on opening, provides manual
refresh and category filters, and links back to Orders. It performs no payment,
stock, refund, or email mutations.

This is a timestamped snapshot of persisted work, not a live provider status check.
Failed refreshes clear the previous snapshot rather than showing stale success.
The response includes order IDs and prescribed actions; it excludes customer
addresses, receipt capabilities, email payloads, and raw provider error messages.

Items requiring attention:

- Checkout/refund requests unfinished for five minutes, or with an unknown age:
  compare the order with Stripe before retrying. Paid/canceled checkout requests
  are excluded when their local order already resolves the request.
- Email errors, missing email credentials, or the provider deduplication cutoff:
  check configuration and delivery history before any manual resend. The dashboard
  has no resend button because a lost response can hide a successful delivery.
- Paid orders without stock: replenish and sync payment, or refund before fulfillment.
- Failed stock recovery for a currently held order: inspect Stripe connectivity.
  Old recovery errors are excluded once the hold is resolved.
- Holds more than 48 hours past their deadline: review the payment. This is an
  investigation threshold, not permission to release processing payments.

Recent requests, normal holds and configured email queues are shown as waiting.
Zero items means no outstanding work found in this snapshot; it does not certify
Stripe, email delivery, backups, or the public website as healthy.

## Verified hosting findings — 2026-09-21

Read-only inspection of the existing Render workspace showed:

- Shop web service is Starter; Postgres is Basic-256mb, PostgreSQL 18.
- Live commit is `02713eb871bab9af8a0f805b6065500ef5718a13` (phase four).
- Build, pre-deploy and start commands match the repository instructions.
- Workspace notification destination is Email with Only failure notifications.
  The shop inherits that preference. Actual inbox delivery has not been tested.
- The shop's Health Check Path was blank despite the Blueprint value. The public
  `/health` endpoint returned HTTP 200 with `{"ok":true}`. The path was saved as
  `/health` on 2026-09-21, triggering a configuration redeploy of phase-four commit
  `02713eb`. Render deployment `dep-daocpl740ujc73eq7k80` succeeded and is live; a subsequent
  public check again returned HTTP 200 with `{"ok":true}`.
- No active shop staging service/database was found in the workspace's active
  service inventory or its existing project. Suspended resources were not audited.
- The database Recovery screen advertises a three-day restore window and offers
  Restore database / Create export. No restore was started or verified.

These observations are not claims that production rehearsals passed.

## Next hosting actions

1. Keep the shop's Render **Settings > Health Checks** path at `/health`. The configuration redeploy was verified live and the public endpoint healthy. This
   enables an HTTP check of the database-aware endpoint. No new secret is needed.
2. Keep the existing failure-email preference. Confirm the account inbox receives
   a staging failure notification; do not intentionally break production.
3. Create a separate staging web service and empty database after approving their
   resource cost. Use Stripe test credentials, a separate test webhook, test auth,
   and synthetic orders. Do not copy production email recipients or pending jobs.
4. Consider an external HTTPS uptime monitor for `https://servbotshop.com/health`.
   Use an owner-approved provider and destination; configure sustained failure and
   recovery alerts. Render alerts do not replace an independent public DNS/TLS check.
5. Proactive alerts for stuck business operations still need an approved delivery
   destination and transport. This PR exposes the information in the dashboard;
   it does not send incident email, create a monitor, or claim alert delivery works.

Render documents failure notifications for unhealthy services and failed deploys,
and HTTP health checks for readiness and restart decisions:
[notifications](https://render.com/docs/notifications),
[health checks](https://render.com/docs/health-checks).

## Restore rehearsal

Use a separate temporary recovery database; never overwrite or repoint production
for a rehearsal. A recovery copy can contain customer information and pending
payment/email jobs. Do not attach a running shop worker to it or use it as a public
staging database. Validate it through read-only database access, keeping secrets
and row contents out of logs and evidence files.

1. Approve the temporary instance's displayed cost and select an available recovery
   timestamp. Name the copy clearly, such as `midnight-cardworks-recovery-test`.
2. Wait for the new instance to be available. Record the source timestamp, elapsed
   recovery time, instance name and outcome without recording connection strings.
3. Check migration history and aggregate counts for Product, Order, OrderItem and
   PaymentJournal. Validate nonnegative counters and that reserved quantities match
   held order items. Compare against evidence for the chosen restore point, not
   against production data that has changed since then.
4. Record any discrepancy and whether the rehearsal passes. Obtain explicit cleanup
   approval before deleting a recovery database. Keep the production connection
   and original database unchanged throughout.

Render's point-in-time restore creates another database. Its documented recovery
window depends on workspace plan. Logical exports are a separate retention option.
Use client tools compatible with the target PostgreSQL major version for export
restores; this production database is version 18, whereas local unit/integration
work previously used version 15. See
[Render recovery instructions](https://render.com/docs/postgresql-backups).

## Staging acceptance record

Record the deployed commit, date, environment, tester and result for each case.
Use synthetic identities and provider test mode; no live charges or customer emails.

- Successful and discounted checkout: one payment, one stock consumption, accurate
  receipt, and expected test recipient notifications.
- Abandoned/expired checkout: release once; a second buyer can reserve the unit.
- Delayed payment: retain stock while processing, consume on success, release only
  after confirmed failure.
- Fulfillment and partial/full refund: correct order state, no automatic restock,
  no duplicate side effects after event replay.
- Health dashboard: induce a test-only queue/provider failure, verify an attention
  item, repair the cause, refresh, and verify it clears.
- Service alerts: induce a staging-only failure, verify inbox delivery, restore
  health and document recovery. Test independent uptime monitoring separately.

## Current evidence and remaining gates

Repository tests: 127 API tests passed; eight existing PostgreSQL integration tests
were skipped because no TEST_DATABASE_URL was set. All 89 web tests passed.
`npm run typecheck` and `npm run render:build` passed. This phase adds no migration.

Still pending: verify actual alert receipt; approve and provision staging/recovery resources; perform and record the
restore and end-to-end staging rehearsals. Do not mark phase five fully operational
until those gates have evidence.


## Resource estimate for approval

The public [Render pricing page](https://render.com/pricing), checked 2026-09-21,
lists $7/month for 512 MB web compute and $6/month for 256 MB Postgres compute.
A separate staging pair is therefore $13/month in compute. A temporary recovery
copy adds a $6/month compute rate, prorated while running. Extra storage, bandwidth,
pipeline usage and taxes can add charges. No workspace upgrade is proposed.
Creation requires approval of the displayed price; no resources have been created.
