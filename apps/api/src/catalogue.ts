import type { PrismaClient } from '@prisma/client';
import { etsyListings } from './etsyCatalogue.js';
import { CARD_TYPES, COLOUR_IDENTITIES, cardTaxonomy } from './cardTaxonomy.js';
import type { Product } from './types.js';

/**
 * The storefront's real catalogue, committed so the server can seed it on boot instead of it
 * existing only as a local CSV. `etsyCatalogue.ts` is generated from the shop's Etsy export
 * by `scripts/import-etsy-listings.ts --emit`, so the provenance of every listing is recorded
 * in the file header and the data can be regenerated rather than hand-edited.
 */
/** Every tag value the taxonomy owns. Anything else on a listing belongs to the owner. */
const TAXON_TAGS = new Set<string>([...CARD_TYPES, ...COLOUR_IDENTITIES]);

/**
 * The card-type and colour-identity tags for a listing, when the taxonomy knows the listing.
 * Empty for anything Scryfall had no card for and no rule covers.
 */
export function taxonomyTagsFor(slug: string): string[] {
  const facets = cardTaxonomy[slug];
  if (!facets) return [];
  return facets.colour ? [facets.type, facets.colour] : [facets.type];
}

/**
 * A listing with its taxonomy tags merged in. Any taxon tag already present is replaced rather
 * than duplicated, and the listing's own Etsy tags are left exactly as they are.
 */
export function withTaxonomyTags(listing: Product): Product {
  const taxon = taxonomyTagsFor(listing.slug);
  if (taxon.length === 0) return listing;
  return { ...listing, tags: [...listing.tags.filter((tag) => !TAXON_TAGS.has(tag)), ...taxon] };
}

/**
 * The storefront's catalogue, with each listing's card type and colour identity tagged on. The
 * taxonomy is provenance-tracked in `cardTaxonomy.ts`, so these two tags are derived data rather
 * than copy the owner wrote.
 */
export const catalogueListings: Product[] = etsyListings.map(withTaxonomyTags);

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

/**
 * Bring the card-type and colour tags on already-seeded listings up to date.
 *
 * The seed above is create-only, so that a listing the owner has since edited in /admin is never
 * overwritten by a restart. These two tags are the deliberate exception, because they are derived
 * rather than authored: they are the taxonomy the storefront filters read, so a listing that
 * predates a taxonomy change has to pick the change up or the filters quietly lie.
 *
 * The merge is narrow on purpose. Only tag values that are card types or colour identities are
 * replaced; every other tag the owner has set is preserved untouched, and a listing with no
 * taxonomy entry is skipped entirely.
 *
 * Idempotent: listings whose tags already match are skipped, so an uneventful boot writes nothing.
 */
export async function syncTaxonomyTags(prisma: PrismaClient, listings: Product[] = catalogueListings) {
  const wanted = listings.filter((listing) => taxonomyTagsFor(listing.slug).length > 0);
  if (wanted.length === 0) return { count: 0 };

  const existing = await prisma.product.findMany({
    where: { slug: { in: wanted.map((listing) => listing.slug) } },
    select: { slug: true, tags: true },
  });
  const currentBySlug = new Map(existing.map((product) => [product.slug, product.tags]));

  let count = 0;
  for (const listing of wanted) {
    const current = currentBySlug.get(listing.slug);
    if (!current) continue;
    // Merge rather than replace: drop whatever taxon tags are there and append the correct ones,
    // leaving every other tag - including anything added in /admin - exactly where it was.
    const merged = [...current.filter((tag) => !TAXON_TAGS.has(tag)), ...taxonomyTagsFor(listing.slug)];
    const same = current.length === merged.length && current.every((tag, i) => tag === merged[i]);
    if (same) continue;
    await prisma.product.update({ where: { slug: listing.slug }, data: { tags: merged } });
    count += 1;
  }
  return { count };
}
