# Midnight Cardworks

Private MVP ecommerce storefront for custom card listings. The UI is an original neon-yellow, TV-world inspired interface: bold contrast, card-grid drama, and collector-first storytelling without using any Persona assets.

## MVP features

- Clerk customer accounts with production sign-in/sign-up wiring
- Product catalog, search, category filters, product detail cards
- Shareable product detail pages at `/products/:slug` with server-rendered SEO meta tags, Open Graph previews, canonical URLs, and product structured data
- Launch-polished storefront with trust cues, inventory status, tags, sold-out handling, and empty search state
- Persistent browser cart with quantity controls
- Checkout flow collects receipt email, customer name, and shipping address before Stripe Checkout
- Email notifications for paid orders and fulfilled orders via Resend
- Admin dashboard for listing management and order review, restricted to allowlisted Clerk admin emails
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

## Product SEO Pages

Each active listing has a public route at `/products/:slug`.

- Product cards link to their detail page for direct sharing.
- Fastify injects product-specific `<title>`, meta description, canonical link, Open Graph product tags, and JSON-LD structured data into the served HTML for crawlers/social previews.
- Inactive listings remain hidden from the public catalog and are not used for public SEO pages.
- Keep product titles/descriptions specific and customer-readable in admin because they become SEO/share preview copy.

## Stripe Checkout

The checkout endpoint is production-ready at the service seam:

- Without `STRIPE_SECRET_KEY`, local checkout returns a demo success URL.
- With `STRIPE_SECRET_KEY`, `/api/checkout` creates a real Stripe Checkout Session.
- Stripe webhooks should point to `/api/stripe/webhook`.
- The webhook marks orders `paid` when it receives `checkout.session.completed` with `metadata.orderId`.
- `/api/checkout` accepts `customerName` and `shippingAddress`; receipts and admin order review display those details.
- Admins can mark paid orders `fulfilled` after shipping/hand-off.
- When Resend is configured, paid orders send a customer confirmation email plus an optional shop-owner notification. Fulfilled orders send a customer fulfillment email.

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

## Email Notifications

Email sending is optional and uses Resend when configured. Without `RESEND_API_KEY` or `EMAIL_FROM`, the app safely skips sending email so local checkout still works.

```bash
RESEND_API_KEY=re_...
EMAIL_FROM=Midnight Cardworks <orders@your-domain.com>
ORDER_NOTIFICATION_EMAIL=owner@example.com
```

- `EMAIL_FROM` must be a verified Resend sender/domain.
- Customer confirmation emails are sent after Stripe confirms payment via webhook.
- Customer fulfillment emails are sent when an admin marks an order fulfilled.
- `ORDER_NOTIFICATION_EMAIL` is optional and receives owner copies for newly paid orders.

## Customer Accounts

Clerk is wired into the frontend for production sign-in/sign-up/account management.

- Without `VITE_CLERK_PUBLISHABLE_KEY`, the app shows a safe setup prompt instead of a fake email account form.
- With `VITE_CLERK_PUBLISHABLE_KEY`, the account page uses Clerk's modal sign-in flow and user menu.

Required production env var:

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_live_or_test_key
```

Create the key in Clerk, add your production domain in Clerk's dashboard, and set the env var before deployment.

## Admin Access

Admin dashboard UI and admin API routes are restricted to signed-in Clerk users whose email appears in the admin allowlist.

Protected API routes:

```text
GET /api/admin/orders
POST /api/admin/orders/:orderId/fulfill
GET /api/admin/products
POST /api/admin/products
POST /api/admin/products/:slug/image
```

Required production env vars:

```bash
CLERK_SECRET_KEY=sk_live_or_test_key
ADMIN_EMAILS=owner@example.com
VITE_ADMIN_EMAILS=owner@example.com
```

- `CLERK_SECRET_KEY` stays server-only and lets the API verify Clerk session tokens and fetch the signed-in user's email.
- `ADMIN_EMAILS` is the backend allowlist that actually protects admin actions.
- `VITE_ADMIN_EMAILS` only controls whether the frontend shows the Admin button. It must match `ADMIN_EMAILS`, but it is not a security boundary.
- Separate multiple admin emails with commas.

Admin product management supports creating new listings, editing existing listing title/description/price/category/tags/inventory/image URL, toggling active/inactive status, and uploading listing images. Inactive listings remain visible in admin but are hidden from the public storefront.

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

Production deploys should run migrations before the API starts. The included Render Blueprint does this with:

```bash
npm run render:build
```

Seed products are upserted on API startup when Prisma storage is enabled, so the initial catalog is present after deployment.

## Product Image Uploads

The admin dashboard can upload replacement product images. The frontend reads the image file as a data URL, sends it to the API, and the API updates the product's stored image URL.

- Without `CLOUDINARY_URL`, local/test uploads echo the data URL so the flow works without credentials.
- With `CLOUDINARY_URL`, the API uploads images to Cloudinary under `midnight-cardworks/products` and stores the returned secure URL.

Required production env var:

```bash
CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
```

Do not commit real Cloudinary credentials. Add the value only in the production host's environment settings.

## Render Deployment

This repo includes `render.yaml`, so Render can create the web service and Postgres database from GitHub.

Deployment flow:

1. In Render, create a new Blueprint from the private GitHub repo.
2. Render reads `render.yaml` and creates:
   - `midnight-cardworks` web service
   - `midnight-cardworks-db` Postgres database
3. Fill the secret env vars in Render:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET` after webhook creation
   - `VITE_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
   - `ADMIN_EMAILS`
   - `VITE_ADMIN_EMAILS`
   - `CLOUDINARY_URL`
   - `APP_BASE_URL` after Render gives the live URL
4. Deploy.
5. After the first deploy, set `APP_BASE_URL` to the Render URL, then redeploy.
6. In Stripe, add webhook endpoint:

```text
https://your-render-url.onrender.com/api/stripe/webhook
```

Render commands:

```bash
Build: npm ci --include=dev && npm run render:build
Start: npm run start
```

Production behavior:

- Fastify serves the built React app from `apps/web/dist`.
- Frontend API calls use same-origin URLs when `VITE_API_BASE_URL` is empty.
- Non-API routes return the React app for browser refresh/client-side navigation.
- Missing API routes return JSON 404s.

## Next production steps

1. Deploy on Render and test the live URL.
2. Add Clerk-backed admin route protection before accepting real admin traffic.
