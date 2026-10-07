import { beforeEach, describe, expect, it, vi } from 'vitest';

// Records what the store factory asks the database to do, without needing a real Postgres.
const calls = vi.hoisted(() => ({
  createMany: [] as Array<{ data: Array<{ slug: string }>; skipDuplicates?: boolean }>,
  updateMany: [] as Array<{ where: { slug: { in: string[] }; active: boolean }; data: { active: boolean } }>,
  findMany: [] as Array<{ where: { slug: { in: string[] } }; select?: unknown }>,
  update: [] as Array<{ where: { slug: string }; data: { tags: string[]; category?: string } }>,
  upsert: 0,
  /** What findMany reports as already stored. A test sets this to provoke an update. */
  storedRows: [] as Array<{ slug: string; tags: string[]; category?: string }>,
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    product = {
      createMany: async (args: { data: Array<{ slug: string }>; skipDuplicates?: boolean }) => {
        calls.createMany.push(args);
        return { count: 0 };
      },
      updateMany: async (args: { where: { slug: { in: string[] }; active: boolean }; data: { active: boolean } }) => {
        calls.updateMany.push(args);
        return { count: 0 };
      },
      findMany: async (args: { where: { slug: { in: string[] } }; select?: unknown }) => {
        calls.findMany.push(args);
        return calls.storedRows;
      },
      update: async (args: { where: { slug: string }; data: { tags: string[] } }) => {
        calls.update.push(args);
        return {};
      },
    };
    faqItem = { upsert: async () => { calls.upsert += 1; return {}; } };
    blogPost = { upsert: async () => { calls.upsert += 1; return {}; } };
    $disconnect = async () => {};
  },
}));

const { createStoreFromEnv } = await import('./storeFactory.js');
const { catalogueListings, RETIRED_LISTING_SLUGS } = await import('./catalogue.js');
const { CARD_TYPES, COLOUR_IDENTITIES } = await import('./cardTaxonomy.js');

const DB_ENV = { NODE_ENV: 'development', DATABASE_URL: 'postgres://user:pass@localhost:5432/shop' };

beforeEach(() => {
  calls.createMany.length = 0;
  calls.updateMany.length = 0;
  calls.findMany.length = 0;
  calls.update.length = 0;
  calls.storedRows = [];
  calls.upsert = 0;
});

describe('createStoreFromEnv wiring', () => {
  it('seeds the committed catalogue into the database on startup', async () => {
    await createStoreFromEnv(DB_ENV);
    const seeded = calls.createMany.flatMap((c) => c.data.map((d) => d.slug));
    for (const listing of catalogueListings.slice(0, 5)) {
      expect(seeded).toContain(listing.slug);
    }
  });

  it('seeds every catalogue listing with skipDuplicates so /admin edits survive a restart', async () => {
    await createStoreFromEnv(DB_ENV);
    const catalogueCall = calls.createMany.find((c) => c.data.length === catalogueListings.length);
    expect(catalogueCall, 'the full catalogue should be seeded in one call').toBeDefined();
    expect(catalogueCall!.skipDuplicates).toBe(true);
  });

  it('retires the placeholders and the test listing on startup', async () => {
    await createStoreFromEnv(DB_ENV);
    expect(calls.updateMany).toHaveLength(1);
    expect(calls.updateMany[0].where).toEqual({ slug: { in: RETIRED_LISTING_SLUGS }, active: true });
    expect(calls.updateMany[0].data).toEqual({ active: false });
  });

  it('still seeds FAQ and blog content', async () => {
    await createStoreFromEnv(DB_ENV);
    expect(calls.upsert).toBeGreaterThan(0);
  });

  it('touches no database at all when DATABASE_URL is absent', async () => {
    await createStoreFromEnv({ NODE_ENV: 'development' });
    expect(calls.createMany).toEqual([]);
    expect(calls.updateMany).toEqual([]);
    expect(calls.upsert).toBe(0);
  });

  it('never deletes a product while retiring', async () => {
    await createStoreFromEnv(DB_ENV);
    // The factory only ever creates and updates; deletion would break OrderItem history.
    expect(calls.createMany).toHaveLength(2); // seed fixtures + the real catalogue
    expect(calls.updateMany).toHaveLength(1);
  });
});

describe('card taxonomy', () => {
  it('tags every listing with its card type and colour identity', () => {
    const force = catalogueListings.find((l) => l.slug === 'force-of-will-proxy-card');
    expect(force?.tags).toContain('Instant');
    expect(force?.tags).toContain('Blue');
    // the owner's own Etsy tags are still there alongside them
    expect(force?.tags).toContain('edh proxy card');

    const land = catalogueListings.find((l) => l.slug === 'serras-sanctum');
    expect(land?.tags).toContain('Land');
    expect(land?.tags).toContain('White');
  });

  it('gives a commission a category and no card type at all', () => {
    const commission = catalogueListings.find((l) => l.slug === 'cabbage-merchant-proxy');
    // a commission is a kind of product, not a kind of card
    expect(commission?.category).toBe('Commission');
    expect(commission?.tags).not.toContain('Commission');
    for (const type of ['Instant', 'Land', 'Token', 'Set', 'Commission']) {
      expect(commission?.tags, type).not.toContain(type);
    }
    // and so it carries no colour either
    expect(commission?.tags.filter((t) => COLOUR_IDENTITIES.includes(t as never))).toEqual([]);
  });

  it('files every commission listing under the Commission category', () => {
    const commissions = catalogueListings.filter((l) => /commission/i.test(l.title));
    expect(commissions.length).toBeGreaterThan(0);
    for (const listing of commissions) {
      expect(listing.category, listing.slug).toBe('Commission');
    }
  });

  it('gives a card type to every listing that has a taxonomy entry, and none to the rest', async () => {
    const { cardTaxonomy } = await import('./cardTaxonomy.js');
    const untagged: string[] = [];
    for (const listing of catalogueListings) {
      const facets = cardTaxonomy[listing.slug];
      if (!facets) {
        // no entry means no card type, which is the honest state for a commission
        untagged.push(listing.slug);
        expect(listing.tags.filter((t) => CARD_TYPES.includes(t as never)), listing.slug).toEqual([]);
        continue;
      }
      expect(listing.tags, listing.slug).toContain(facets.type);
      if (facets.colour) expect(listing.tags, listing.slug).toContain(facets.colour);
    }
    // the only listings without a type are the commissions, and there is no Commission card type
    expect(untagged.sort()).toEqual(
      catalogueListings.filter((l) => l.category === 'Commission').map((l) => l.slug).sort(),
    );
    expect(CARD_TYPES).not.toContain('Commission' as never);
  });

  it('brings listings that predate the taxonomy into step without losing their own tags', async () => {
    calls.storedRows = [{ slug: 'force-of-will-proxy-card', tags: ['force proxy card', 'Berserk'] }];
    await createStoreFromEnv(DB_ENV);

    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].where).toEqual({ slug: 'force-of-will-proxy-card' });
    expect(calls.update[0].data.tags).toContain('Instant');
    expect(calls.update[0].data.tags).toContain('Blue');
    // the owner's tags survive the merge, ahead of the taxonomy
    expect(calls.update[0].data.tags).toContain('force proxy card');
    expect(calls.update[0].data.tags).toContain('Berserk');
    expect(calls.update[0].data.tags.slice(-2)).toEqual(['Instant', 'Blue']);
  });

  it('writes nothing when a listing already carries the right tags', async () => {
    const force = catalogueListings.find((l) => l.slug === 'force-of-will-proxy-card')!;
    calls.storedRows = [{ slug: force.slug, tags: [...force.tags] }];
    await createStoreFromEnv(DB_ENV);
    expect(calls.update).toEqual([]);
  });

  it('leaves a listing the taxonomy does not know about alone', async () => {
    calls.storedRows = [{ slug: 'not-in-the-taxonomy', tags: ['whatever'] }];
    await createStoreFromEnv(DB_ENV);
    expect(calls.update).toEqual([]);
  });

  it('takes the retired Commission tag back off a listing that still carries it', async () => {
    calls.storedRows = [{ slug: 'cabbage-merchant-proxy', tags: ['custom proxy card', 'Commission'], category: 'Custom' }];
    await createStoreFromEnv(DB_ENV);

    const update = calls.update.find((u) => u.where.slug === 'cabbage-merchant-proxy');
    expect(update, 'the commission listing should have been rewritten').toBeDefined();
    expect(update!.data.tags).toEqual(['custom proxy card']);
    expect(update!.data.category).toBe('Commission');
  });

  it('re-files a commission that is still sitting under the old category', async () => {
    calls.storedRows = [{ slug: 'cabbage-merchant-proxy', tags: [], category: 'Custom' }];
    await createStoreFromEnv(DB_ENV);
    const update = calls.update.find((u) => u.where.slug === 'cabbage-merchant-proxy');
    expect(update!.data.category).toBe('Commission');
  });

  it("leaves an ordinary listing's own category alone", async () => {
    // the owner moved this one to Lands in /admin; a boot must not pull it back
    calls.storedRows = [{ slug: 'force-of-will-proxy-card', tags: ['force proxy card', 'Instant', 'Blue'], category: 'Lands' }];
    await createStoreFromEnv(DB_ENV);
    const update = calls.update.find((u) => u.where.slug === 'force-of-will-proxy-card');
    expect(update, 'nothing about this listing needed writing').toBeUndefined();
  });
});
