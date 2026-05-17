# Midnight Cardworks

Private MVP ecommerce storefront for custom card listings. The UI is an original neon-yellow, TV-world inspired interface: bold contrast, card-grid drama, and collector-first storytelling without using any Persona assets.

## MVP features

- Customer account mock flow with local demo session
- Product catalog, search, category filters, product detail cards
- Persistent browser cart with quantity controls
- Checkout flow that creates orders through the API; Stripe-ready service seam
- Admin dashboard for listing management and order review
- Fastify API with in-memory/file-backed store
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

## Next production steps

1. Replace demo auth with Clerk/Supabase Auth.
2. Move store to Postgres/Prisma.
3. Add image uploads via Cloudinary/UploadThing.
4. Deploy API + web on Render/Vercel.
