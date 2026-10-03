import { beforeEach, describe, expect, it, vi } from 'vitest';

// Records what the store factory asks the database to do, without needing a real Postgres.
const calls = vi.hoisted(() => ({
  createMany: [] as Array<{ data: Array<{ slug: string }>; skipDuplicates?: boolean }>,
  updateMany: [] as Array<{ where: { slug: { in: string[] }; active: boolean }; data: { active: boolean } }>,
  upsert: 0,
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
