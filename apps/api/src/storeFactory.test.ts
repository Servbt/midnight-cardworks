import { beforeEach, describe, expect, it, vi } from 'vitest';

// Records what the store factory asks the database to do, without needing a real Postgres.
const calls = vi.hoisted(() => ({
  createMany: [] as Array<{ data: Array<{ slug: string }>; skipDuplicates?: boolean }>,
  updateMany: [] as Array<{ where: { slug: { in: string[] }; active: boolean }; data: { active: boolean } }>,
  findMany: [] as Array<{ where: { slug: { in: string[] } }; select?: unknown }>,
  update: [] as Array<{ where: { slug: string }; data: { tags: string[] } }>,
  upsert: 0,
  /** What findMany reports as already stored. A test sets this to provoke an update. */
  storedRows: [] as Array<{ slug: string; tags: string[] }>,
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

  it('gives a listing with no single colour its type and no colour tag', () => {
    const commission = catalogueListings.find((l) => l.slug === 'cabbage-merchant-proxy');
    expect(commission?.tags).toContain('Commission');
    expect(commission?.tags).not.toContain('Colorless');
  });

  it('knows a type and colour for every listing in the catalogue', async () => {
    const { cardTaxonomy } = await import('./cardTaxonomy.js');
    expect(Object.keys(cardTaxonomy).length).toBe(catalogueListings.length);
    for (const listing of catalogueListings) {
      const facets = cardTaxonomy[listing.slug];
      expect(facets, listing.slug).toBeDefined();
      expect(listing.tags, listing.slug).toContain(facets.type);
      if (facets.colour) expect(listing.tags, listing.slug).toContain(facets.colour);
    }
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
});
