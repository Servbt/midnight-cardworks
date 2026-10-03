import type { PrismaClient } from '@prisma/client';
import { etsyListings } from './etsyCatalogue.js';
import type { Product } from './types.js';

/**
 * The storefront's real catalogue, committed so the server can seed it on boot instead of it
 * existing only as a local CSV. `etsyCatalogue.ts` is generated from the shop's Etsy export
 * by `scripts/import-etsy-listings.ts --emit`, so the provenance of every listing is recorded
 * in the file header and the data can be regenerated rather than hand-edited.
 */
export const catalogueListings: Product[] = etsyListings;

/**
 * Listings that must not be visible on the storefront: the four seed placeholders, which
 * ship with Unsplash stand-ins rather than the shop's own art, and one live test listing
 * ("Test Cardd") left over from earlier work.
 */
export const RETIRED_LISTING_SLUGS = [
  // Seed placeholders.
  'golden-hour-commander-proxy',
  'midnight-token-pack',
  'velvet-archive-display-card',
  'social-link-land-set',
  // Live test listing.
  'great',
];

/**
 * Insert any catalogue listing that is not already present.
 *
 * `skipDuplicates` makes this idempotent and, deliberately, non-destructive: a listing the
 * owner has since edited in /admin is never overwritten by a redeploy or a restart. If the
 * catalogue ever needs to push edits out, that wants an explicit, deliberate mechanism
 * rather than a seed that silently reverts someone's work.
 */
export async function seedCatalogueListings(prisma: PrismaClient, listings: Product[] = catalogueListings) {
  if (listings.length === 0) return { count: 0 };
  return prisma.product.createMany({ data: listings, skipDuplicates: true });
}

/**
 * Take the placeholders and test listings off the storefront.
 *
 * Deactivates rather than deletes: OrderItem references Product, so deleting a product that
 * appears on any past order would either fail or destroy order history. Setting active=false
 * removes it from the storefront, the nav and the sidebar while leaving history intact.
 *
 * Idempotent — the `active: true` filter means rows already retired are not rewritten, so
 * this is safe on every boot.
 */
export async function retireListings(prisma: PrismaClient, slugs: string[] = RETIRED_LISTING_SLUGS) {
  const { count } = await prisma.product.updateMany({
    where: { slug: { in: slugs }, active: true },
    data: { active: false },
  });
  return { count };
}
