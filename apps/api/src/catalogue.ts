import type { PrismaClient } from '@prisma/client';
import { etsyListings } from './etsyCatalogue.js';
import { CARD_TYPES, COLOUR_IDENTITIES, cardTaxonomy } from './cardTaxonomy.js';
import type { Product } from './types.js';

/**
 * The storefront's real catalogue, committed so the server can seed it on boot instead of it
 * existing only as a local CSV. `etsyCatalogue.ts` is generated from the shop's Etsy export by
 * `scripts/import-etsy-listings.ts --emit`, so the provenance of every listing is recorded in the
 * file header and the data can be regenerated rather than hand-edited.
 *
 * Everything the export cannot express is layered on below: the card-type and colour tags, and
 * the one category Etsy has no bucket for.
 */

/** Every tag value the taxonomy owns. Anything else on a listing belongs to the owner. */
const TAXON_TAGS = new Set<string>([...CARD_TYPES, ...COLOUR_IDENTITIES]);

/**
 * Tag values that used to be card types and are not any more. Commission became a category, so it
 * has to be taken back off the listings that still carry it: leaving it in TAXON_TAGS would keep
 * offering it as a card type, and dropping it entirely would strand the old tag on the rows.
 */
const RETIRED_TAXON_TAGS = new Set<string>(['Commission']);

/**
 * Categories Etsy has no equivalent for. Its taxonomy has no commission bucket, so the importer
 * used to file these under Custom; it now returns Commission for them, but the committed snapshot
 * predates that and cannot be re-emitted without the original export. The correction is applied
 * here until the catalogue is regenerated, at which point this map can go.
 */
const CATEGORY_CORRECTIONS: Record<string, string> = {
  'cabbage-merchant-proxy': 'Commission',
  'custom-mtg-proxy-card-commission-anime-style-edh-commander-c': 'Commission',
};

/**
 * The card-type and colour-identity tags for a listing, when the taxonomy knows the listing. Empty
 * for anything Scryfall had no card for and no rule covers - which is the honest answer for a
 * commission, since it is not a card.
 */
export function taxonomyTagsFor(slug: string): string[] {
  const facets = cardTaxonomy[slug];
  if (!facets) return [];
  return facets.colour ? [facets.type, facets.colour] : [facets.type];
}

/** A listing's tags, with every taxon tag - retired ones included - taken off. */
function withoutTaxonTags(tags: string[]): string[] {
  return tags.filter((tag) => !TAXON_TAGS.has(tag) && !RETIRED_TAXON_TAGS.has(tag));
}

/**
 * A listing with its card type, colour identity and corrected category applied. Taxon tags already
 * present are replaced rather than duplicated, and the listing's own Etsy tags are left as they are.
 */
export function withCatalogueFacets(listing: Product): Product {
  return {
    ...listing,
    category: CATEGORY_CORRECTIONS[listing.slug] ?? listing.category,
    tags: [...withoutTaxonTags(listing.tags), ...taxonomyTagsFor(listing.slug)],
  };
}

/**
 * The storefront's catalogue: the Etsy export with each listing's card type and colour identity
 * tagged on. The taxonomy is provenance-tracked in `cardTaxonomy.ts`, so these two tags are derived
 * data rather than copy the owner wrote.
 */
export const catalogueListings: Product[] = etsyListings.map(withCatalogueFacets);

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
 * Bring the card-type, colour and corrected-category facets on already-seeded listings up to date.
 *
 * The seed above is create-only, so that a listing the owner has since edited in /admin is never
 * overwritten by a restart. These facets are the deliberate exception, because they are derived
 * rather than authored: they are what the storefront filters read, so a listing that predates a
 * change has to pick it up or the filters quietly lie.
 *
 * The merge is narrow on purpose. Only tag values that are card types or colour identities (or
 * retired ones) are replaced, and only listings with an explicit category correction are re-filed,
 * so every other tag and category the owner has set is preserved. A listing with no taxonomy entry
 * is still visited, because that is how a retired tag gets taken off it.
 *
 * Idempotent: listings that already match are skipped, so an uneventful boot writes nothing.
 */
export async function syncCatalogueFacets(prisma: PrismaClient, listings: Product[] = catalogueListings) {
  if (listings.length === 0) return { count: 0 };

  const existing = await prisma.product.findMany({
    where: { slug: { in: listings.map((listing) => listing.slug) } },
    select: { slug: true, tags: true, category: true },
  });
  const currentBySlug = new Map(existing.map((product) => [product.slug, product]));

  let count = 0;
  for (const listing of listings) {
    const current = currentBySlug.get(listing.slug);
    if (!current) continue;

    // Merge rather than replace: drop whatever taxon tags are there and append the correct ones,
    // leaving every other tag - including anything added in /admin - exactly where it was.
    const tags = [...withoutTaxonTags(current.tags), ...taxonomyTagsFor(listing.slug)];
    const data: { tags: string[]; category?: string } = { tags };
    if (CATEGORY_CORRECTIONS[listing.slug]) data.category = CATEGORY_CORRECTIONS[listing.slug];

    const tagsSame = current.tags.length === tags.length && current.tags.every((tag, i) => tag === tags[i]);
    const categorySame = data.category === undefined || current.category === data.category;
    if (tagsSame && categorySame) continue;

    await prisma.product.update({ where: { slug: listing.slug }, data });
    count += 1;
  }
  return { count };
}
