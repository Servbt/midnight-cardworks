# Midnight Cardworks

Private MVP ecommerce storefront for custom card listings. The UI is an original neon-yellow, TV-world inspired interface: bold contrast, card-grid drama, and collector-first storytelling without using any Persona assets.

## MVP features

- Customer account mock flow with local demo session
- Product catalog, search, category filters, product detail cards
- Persistent browser cart with quantity controls
- Checkout flow that creates orders through the API; Stripe-ready service seam
- Admin dashboard for listing management and order review
- Fastify API with Prisma/Postgres-ready persistence
- React/Vite frontend with Vitest coverage

## Local development

```bash
npm install
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000

## Verification

```bash
npm run test
npm run typecheck
npm run build
```

## Stripe Checkout

The checkout endpoint is production-ready at the service seam:

- Without `STRIPE_SECRET_KEY`, local checkout returns a demo success URL.
- With `STRIPE_SECRET_KEY`, `/api/checkout` creates a real Stripe Checkout Session.
- Stripe webhooks should point to `/api/stripe/webhook`.
- The webhook marks orders `paid` when it receives `checkout.session.completed` with `metadata.orderId`.

Required production env vars:

```bash
STRIPE_SECRET_KEY=sk_live_or_test_key
STRIPE_WEBHOOK_SECRET=whsec_from_stripe_endpoint
APP_BASE_URL=https://your-domain.com
```

Local Stripe CLI test flow:

```bash
stripe listen --forward-to localhost:4000/api/stripe/webhook
# Put the printed whsec_... value into STRIPE_WEBHOOK_SECRET
```

## Customer Accounts

Clerk is wired into the frontend for production sign-in/sign-up/account management.

- Without `VITE_CLERK_PUBLISHABLE_KEY`, the app shows a safe setup prompt instead of a fake email account form.
- With `VITE_CLERK_PUBLISHABLE_KEY`, the account page uses Clerk's modal sign-in flow and user menu.

Required production env var:

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_live_or_test_key
```

Create the key in Clerk, add your production domain in Clerk's dashboard, and set the env var before deployment.

## Database Storage

The API now uses Prisma with PostgreSQL when `DATABASE_URL` is configured. Without `DATABASE_URL`, tests and local demo runs continue to use the in-memory store.

Required production env var:

```bash
DATABASE_URL=postgresql://user:password@host:5432/midnight_cardworks
```

Useful commands:

```bash
npm run db:generate   # regenerate Prisma client
npm run db:dev        # create/apply a local development migration
npm run db:migrate    # apply migrations in production/deploy
```

Production startup should run migrations before the API starts, for example:

```bash
npm run db:migrate && npm run build && npm run dev:api
```

Seed products are upserted on API startup when Prisma storage is enabled, so the initial catalog is present after deployment.

## Next production steps

1. Add image uploads via Cloudinary/UploadThing.
2. Deploy API + web on Render/Vercel.
