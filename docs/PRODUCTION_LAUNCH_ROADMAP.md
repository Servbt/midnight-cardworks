# Midnight Cardworks Production Launch Roadmap

Last updated: 2026-09-21

This document is the source of truth for taking Midnight Cardworks from a working
MVP to a public production shop. Work through one gate at a time. Do not mark a
gate complete until its evidence is recorded here.

## Status Key

- `[ ]` Not started or not verified
- `[-]` In progress
- `[x]` Verified complete
- **Owner: Codex** means repository work or a public verification Codex can do.
- **Owner: Store owner** means a dashboard, billing, legal, or business decision
  that requires the account owner.

## Current Production Snapshot

- Current service URL: `https://midnight-cardworks.onrender.com`
- Hosting: Render web service and Render Postgres
- Hosting verified 2026-09-21: Starter web service and Basic-256mb Postgres.
- Monitoring: Render Health Check Path corrected to `/health` on 2026-09-21;
  configuration redeploy verified live and public endpoint returned HTTP 200.
- Payments: Stripe Checkout, webhook processing, cancellation, and refunds exist
- Authentication: Clerk customer accounts and admin allowlist exist
- Email: Resend transactional and marketing flows exist
- Product media: Cloudinary upload support exists
- Public content: storefront, products, account, privacy, FAQ, blog, and
  `llms.txt` exist
- Admin tools: orders, fulfillment, listings, sales, marketing, FAQ, and blog
  management exist

## Recent engineering phases

These phases are separate from the launch gates below. Older unchecked items
remain unverified unless this evidence explicitly resolves them.

- Phase 2 production configuration: owner reported environment settings verified.
- Phase 3 payment reliability: owner reported merged deployment operational.
- Phase 4 stock reservations: owner reported operational; Render independently
  showed merged commit `02713eb` live on 2026-09-21.
- Phase 5 monitoring/recovery: admin Health dashboard implemented locally. See
  [operational health and remaining gates](OPERATIONS_HEALTH.md). Render already
  uses failure notifications via email, but actual delivery, staging and a restore
  rehearsal remain unverified. The blank production Health Check Path was subsequently corrected to `/health`.

## Gate 1: Production Foundation

Status: **In progress**

Goal: establish the permanent public address, production configuration, database
safety, and a repeatable deploy before connecting live external services.

### 1A. Domain and hosting decisions

- [x] Choose the primary public domain.
  - **Owner: Store owner**
  - Decision: `servbotshop.com`
- [x] Decide whether `www` redirects to the root domain or the root redirects to
  `www`.
  - **Owner: Store owner**
  - Decision: use the root domain; redirect `www.servbotshop.com` to it.
- [x] Confirm Render remains the production host for launch.
  - **Owner: Store owner**
  - Decision: Render remains the launch host.
- [x] Upgrade the Render web service from Free before accepting public orders.
  - **Owner: Store owner**
  - Recommendation: start with the smallest paid web tier, currently named
    `Starter`, and confirm its current price in Render before approving.
  - Reason: Render says Free services are not for production, sleep after 15
    idle minutes, and do not provide dashboard shell or SSH access.
- [x] Upgrade Render Postgres from Free before accepting public orders.
  - **Owner: Store owner**
  - Recommendation: start with the smallest paid Postgres configuration that
    enables recovery, currently `Basic-256mb`, and confirm its current price.
  - Reason: Free Postgres expires after 30 days and has no backup or recovery
    capability; paid Postgres receives point-in-time backups.
- [x] Attach the domain in Render and configure DNS with the registrar.
  - **Owner: Store owner**, guided by Codex
- [x] Verify HTTPS and the preferred-domain redirect.
  - **Owner: Codex**
  - Evidence: On 2026-06-28, root HTTPS, HTTP-to-HTTPS, `www`-to-root,
    and `/health` all passed.

Domain setup sequence after the decision:

1. Upgrade the web service and database to the approved paid tiers.
2. In Render, open the web service, then `Settings` > `Custom Domains`.
3. Add only the preferred address: root domain or `www`. Render automatically
   adds the counterpart and redirects it to the preferred address.
4. At the registrar, remove conflicting `AAAA` records and add the exact DNS
   records Render displays. Record types differ by registrar, so use Render's
   generated values instead of copying values from an unrelated guide.
5. Return to Render and click `Verify`; wait for managed TLS to become valid.
6. Verify HTTP-to-HTTPS and non-preferred-to-preferred redirects.
7. Keep the `onrender.com` address enabled until Clerk, Stripe, Resend, and all
   application URLs have moved and passed smoke tests. Then disable it to avoid
   a duplicate public origin.

Recommended default: use the root domain as primary and redirect `www` to it.

### 1B. Render configuration

- [x] Render Blueprint exists at `render.yaml`.
- [x] The paid-tier deployment generates Prisma and builds both workspaces
  through `npm run render:build`.
- [x] After upgrading the web service, move `npm run db:migrate` from the build
  command to Render's `preDeployCommand`.
  - **Owner: Codex**
  - Reason: Render recommends pre-deploy commands for database migrations, and
    a failed migration then prevents the new build from replacing the healthy
    running version.
- [x] Fastify serves the built web app from `apps/web/dist`.
- [x] `render.yaml` configures an HTTP probe at `/health`, and the endpoint
  verifies database connectivity before reporting healthy.
- [x] A secret-safe environment audit is available through
  `npm run check:production-env` and a launch-blocking strict variant through
  `npm run check:production-env:strict`.
- [ ] Confirm every required variable below exists in the Render service. Compare
  names only; never paste secret values into this document or a chat.

Run `npm run check:production-env` in the Render Shell to perform this check
without printing secret values. Use
`npm run check:production-env:strict` for the final live-mode launch check;
warnings such as Stripe test mode fail in strict mode.

Required server variables:

- [ ] `NODE_ENV=production`
- [ ] `SERVE_STATIC_ROOT=apps/web/dist`
- [ ] `DATABASE_URL`
- [ ] `APP_BASE_URL`
- [ ] `STRIPE_SECRET_KEY`
- [ ] `STRIPE_WEBHOOK_SECRET`
- [ ] `CLERK_SECRET_KEY`
- [ ] `ADMIN_EMAILS`
- [ ] `CLOUDINARY_URL`
- [ ] `RESEND_API_KEY`
- [ ] `EMAIL_FROM`
- [ ] `ORDER_NOTIFICATION_EMAIL`
- [ ] `NEWSLETTER_COUPON_CODE`
- [ ] `MARKETING_POSTAL_ADDRESS`

Required build-time web variables:

- [ ] `VITE_API_BASE_URL` is blank for same-origin production requests
- [ ] `VITE_CLERK_PUBLISHABLE_KEY`
- [ ] `VITE_ADMIN_EMAILS`
- [ ] `VITE_PLAUSIBLE_DOMAIN` if analytics will be enabled at launch
- [ ] `VITE_PLAUSIBLE_SRC` only if using a non-default Plausible script URL

Audit note from 2026-06-27: the repository manifests now declare
`NEWSLETTER_COUPON_CODE`, `MARKETING_POSTAL_ADDRESS`, and the optional Plausible
variables. Their actual presence and values in the Render dashboard still need
to be verified; manifest coverage does not prove that deployed secrets exist.

### 1C. Database and deploy safety

- [ ] Confirm the production service is connected to the intended Render
  Postgres database.
  - **Owner: Store owner**, guided by Codex
- [x] Lock the Prisma migration history to the PostgreSQL provider.
  - **Owner: Codex**
  - Evidence: `migration_lock.toml` exists and Prisma Client generation passes.
- [ ] Confirm every migration in `apps/api/prisma/migrations` is applied to the
  paid production database after the upgrade.
  - **Owner: Codex**
  - Evidence: `____________________________`
- [ ] Choose a backup/restore plan appropriate for accepting real orders.
  - **Owner: Store owner**
  - Recommendation: paid Render Postgres point-in-time recovery plus periodic
    downloaded logical exports for longer retention.
  - Decision: `____________________________`
- [ ] Perform or document one restore rehearsal before public launch.
  - **Owner: Store owner**, guided by Codex
  - Evidence: `____________________________`
- [x] Verify a clean production build and automated test run from the launch
  commit.
  - **Owner: Codex**
  - Evidence: On 2026-06-27, API tests `45/45`, web tests `73/73`, both
    typechecks, and both production builds passed locally.
- [x] Verify `/health`, the storefront, `/faq`, `/blog`, and one product detail
  page on the production service.
  - **Owner: Codex**
  - Evidence: On 2026-06-27, all returned HTTP 200 at the Render URL. The active
    `golden-hour-commander-proxy` product HTML contained its product title.

### Gate 1 exit criteria

- [x] Permanent domain serves valid HTTPS.
- [ ] All required environment variable names are present.
- [ ] Production migrations, backup policy, build, tests, and smoke checks are
  verified and recorded.

## Gate 2: Identity and Admin Security

Status: **Not started**

- [ ] Use Clerk production keys, not test keys.
- [ ] Add the permanent production domain and allowed redirects in Clerk.
- [ ] Verify Google sign-in and account sign-out on production.
- [ ] Verify a non-admin account cannot see or call admin functionality.
- [ ] Verify every intended admin email is in backend `ADMIN_EMAILS`.
- [ ] Verify frontend `VITE_ADMIN_EMAILS` matches the backend allowlist.
- [ ] Review Clerk session/security settings and enable MFA for admin accounts.
- [ ] Record a successful production customer and admin authentication test.

Gate exit: customer auth works on the final domain and admin access is proven to
be denied server-side for non-admin users.

## Gate 3: Stripe Live Mode

Status: **Not started**

- [ ] Complete Stripe account/business verification.
- [ ] Decide whether Stripe Tax is needed and configure tax behavior.
- [ ] Decide the shipping rates and supported destinations used at launch.
- [ ] Replace test credentials with the live secret key in Render.
- [ ] Create a live webhook endpoint at
  `https://<production-domain>/api/stripe/webhook`.
- [ ] Subscribe the webhook to `checkout.session.completed`, `refund.created`,
  `refund.updated`, `refund.failed`, and `charge.refunded`.
- [ ] Put the live webhook signing secret in Render and redeploy.
- [ ] Create the Stripe promotion code advertised by
  `NEWSLETTER_COUPON_CODE`.
- [ ] Run one low-value live purchase using a real payment method.
- [ ] Verify the order moves from pending payment to paid only once.
- [ ] Verify inventory decreases exactly once.
- [ ] Issue and verify a live full or partial refund.
- [ ] Reconcile the transaction, fee, refund, order record, and emails.

Gate exit: one real low-value purchase and refund completes end to end with the
expected order and inventory state.

## Gate 4: Email Deliverability

Status: **Not started**

- [ ] Verify the sending domain in Resend.
- [ ] Publish and validate SPF and DKIM records.
- [ ] Publish a DMARC record with an appropriate initial policy.
- [ ] Set a branded `EMAIL_FROM` address on the final domain.
- [ ] Confirm `ORDER_NOTIFICATION_EMAIL` reaches the store owner.
- [ ] Send and inspect pending-owner, paid-customer, paid-owner, fulfilled,
  canceled, refunded, refund-failed, coupon, campaign, contact, and unsubscribe
  flows.
- [ ] Test delivery to Gmail, Outlook, and Apple/iCloud if practical.
- [ ] Confirm every marketing email includes the postal address and unsubscribe
  link.

Gate exit: all transactional messages arrive and marketing messages satisfy the
required sender identity and unsubscribe behavior.

## Gate 5: Catalog, Fulfillment, and Operations

Status: **Not started**

- [ ] Review every active listing's title, description, category, image, price,
  sale price, stock, and legal copy.
- [ ] Remove test listings and test orders as appropriate.
- [ ] Verify sold-out items cannot be purchased.
- [ ] Verify Cloudinary uploads remain available after a fresh deployment.
- [ ] Document the order workflow: paid, production, packing, shipping, and
  fulfilled.
- [ ] Decide how tracking numbers are communicated for the MVP.
- [ ] Set a daily order-notification and fulfillment routine.
- [ ] Document customer support ownership and response target.

Gate exit: the store owner can operate a real order from payment through delivery
without relying on undocumented steps.

## Gate 6: Policy and Customer Trust

Status: **Not started**

- [ ] Publish a shipping policy with destinations, costs, processing times, and
  estimated delivery times.
- [ ] Publish a refund/cancellation policy that matches the implemented workflow.
- [ ] Publish terms of sale/use.
- [ ] Review the Privacy & Cookies page against the final vendors and analytics
  setup.
- [ ] Confirm the custom/unofficial/not-tournament-legal disclosure is visible
  where customers make purchase decisions.
- [ ] Add business contact information and the required marketing postal address.
- [ ] Obtain professional legal/tax advice where the business owner needs it.

Gate exit: customers can understand what they are buying, when it ships, and how
cancellations, refunds, privacy, and support work before paying.

## Gate 7: Search, Sharing, and Monitoring

Status: **Not started**

- [ ] Update canonical URLs, Open Graph URLs, `llms.txt`, and application base
  URLs to the permanent domain.
- [ ] Add and verify `robots.txt`.
  - Audit note: on 2026-06-27, `/robots.txt` returned the React HTML shell rather
    than a `text/plain` robots file.
- [ ] Add and verify `sitemap.xml` containing public content and active products.
- [ ] Register the site with Google Search Console and submit the sitemap.
- [ ] Verify one product share preview and one blog share preview.
- [ ] Configure Plausible only if analytics is part of the launch decision.
- [ ] Add service/error monitoring and a practical alert destination.
- [ ] Confirm no customer personal data or secrets appear in logs or analytics.

Gate exit: crawlers and social previews use the final domain, and production
failures have an owner-visible signal.

## Gate 8: Production Rehearsal

Status: **Not started**

- [ ] Freeze the launch candidate commit and record its SHA.
- [ ] Run tests, typecheck, and production build from that commit.
- [ ] Test desktop and mobile purchase flows on the production domain.
- [ ] Test sign-in, account history, admin access, listing edits, image upload,
  sale toggle, coupon signup, contact, fulfillment, cancellation, and refund.
- [ ] Verify order and inventory state after webhook retry/replay.
- [ ] Verify database backup and rollback procedures are understood.
- [ ] Complete an accessibility and basic browser pass.
- [ ] Record all results and resolve every launch-blocking issue.

Gate exit: the frozen production candidate passes a complete end-to-end rehearsal
without unresolved launch blockers.

## Gate 9: Soft Launch and Public Launch

Status: **Not started**

- [ ] Soft launch to a small group of trusted buyers.
- [ ] Monitor payments, webhooks, email, inventory, logs, support, and fulfillment
  for at least several real orders.
- [ ] Fix launch-blocking findings and repeat affected rehearsal checks.
- [ ] Confirm inventory, pricing, support availability, and fulfillment capacity.
- [ ] Announce the public launch and send the opted-in launch campaign.
- [ ] Review operational metrics and customer issues daily during launch week.

Gate exit: the shop is publicly accepting and fulfilling real orders, with
payments, customer communications, support, and monitoring operating reliably.

Official references used for this gate:

- Render Free instance limitations: `https://render.com/docs/free`
- Render shell access: `https://render.com/docs/ssh`
- Render Postgres recovery: `https://render.com/docs/postgresql-backups`
- Render instance types: `https://render.com/docs/compute-plans`
- Render custom domains: `https://render.com/docs/custom-domains`
- Render deploy lifecycle: `https://render.com/docs/deploys`

## Decision Log

Record choices that affect later gates so they are not rediscovered.

| Date | Decision | Reason | Owner |
| --- | --- | --- | --- |
| 2026-06-27 | Use this file as the launch source of truth | Preserve progress across sessions | Store owner + Codex |
| 2026-06-28 | Use `servbotshop.com` as the primary domain and redirect `www` to the root | The root domain was added to the paid Render service | Store owner |
| 2026-06-28 | Keep Render as the production host for launch | The service was upgraded and custom-domain setup started | Store owner |
| 2026-06-28 | Use Render `Starter` for web and `Basic-256mb` for Postgres | Smallest production-capable tiers meet the initial MVP needs | Store owner |

## Evidence Log

Record commands, production checks, dashboard confirmations, and relevant commit
SHAs. Never record passwords, API keys, webhook secrets, or database URLs.

| Date | Gate | Evidence | Result |
| --- | --- | --- | --- |
| 2026-06-27 | 1B | Repository contains `render.yaml` and `npm run render:build` | Partial pass; environment names still need audit |
| 2026-06-27 | 1B | Added marketing and optional analytics names to `render.yaml` and `.env.example` | Manifest coverage passes; Render dashboard verification remains |
| 2026-06-27 | 1C | `npm run test`, `npm run typecheck`, and `npm run build` | Pass: 118 tests, both typechecks, both builds |
| 2026-06-27 | 1C | Live Render health, home, FAQ, blog, `llms.txt`, and product checks | Pass: HTTP 200; `robots.txt` gap recorded under Gate 7 |
| 2026-06-27 | 1A/1C | `render.yaml` and current Render Free-instance documentation | Blocker: paid web and Postgres tiers required before public launch |
| 2026-06-27 | 1B | Synthetic strict environment audit | Pass: 0 missing, 0 invalid, 0 warnings; no values printed |
| 2026-06-27 | 1B/1C | Database-aware `/health` plus Render `healthCheckPath` | Pass: healthy returns 200; unavailable storage returns 503 |
| 2026-06-27 | 1A/1B | Current Render domain and deploy lifecycle documentation | Runbook recorded; paid transition must move migrations to pre-deploy |
| 2026-06-27 | 1C | PostgreSQL `migration_lock.toml` plus `npm run db:generate` | Pass: Prisma Client 6.19.3 generated successfully |
| 2026-06-28 | 1A | Public checks for `servbotshop.com`, `www`, HTTP, and `/health` | Pass: valid HTTPS, expected redirects, and HTTP 200 health response |
| 2026-06-28 | 1A/1B | Owner confirmation plus paid-tier Blueprint update | Web set to `starter`; Postgres set to `basic-256mb`; migrations moved to pre-deploy |
| 2026-06-28 | 1B/1C | `npm run render:build`, `npm run test`, and `npm run typecheck` | Pass: production build, 118 tests, and both type checks |

## Next Action

Complete phase five using [the operations runbook](OPERATIONS_HEALTH.md):

1. Review and deploy the admin Health dashboard PR.
2. Keep Render Health Check Path at `/health`; the configuration redeploy and public endpoint passed verification.
3. Verify delivery of existing failure email notifications using staging.
4. Approve separate staging/recovery resources and rehearse a restore without
   connecting application workers or changing production database connections.
5. Run the documented staging purchase, expiration, fulfillment, refund and alert
   checks. Record evidence before marking the remaining launch gates complete.
