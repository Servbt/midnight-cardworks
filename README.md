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

## Next production steps

1. Replace demo auth with Clerk/Supabase Auth.
2. Wire `createCheckoutSession` to live Stripe Checkout.
3. Move store to Postgres/Prisma.
4. Add image uploads via Cloudinary/UploadThing.
5. Deploy API + web on Render/Vercel.
