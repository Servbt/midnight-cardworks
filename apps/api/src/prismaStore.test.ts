import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createPrismaStore, seedPrismaProducts } from './prismaStore.js';
import { seedProducts } from './seed.js';
import type { Product } from './types.js';

describe('Prisma storage wiring', () => {
  it('exports a Prisma-backed store adapter for production persistence', () => {
    expect(typeof createPrismaStore).toBe('function');
  });
});

describe('non-destructive product seeding', () => {
  // Model Postgres createMany skipDuplicates semantics; no live DB is used here.
  function database(initial: Product[] = []) {
    const rows = structuredClone(initial);
    const createMany = vi.fn(async ({ data, skipDuplicates }: { data: Product[]; skipDuplicates: boolean }) => {
      let count = 0;
      for (const product of data) {
        if (rows.some((row) => row.id === product.id || row.slug === product.slug)) {
          if (!skipDuplicates) throw new Error('Unique constraint violation');
          continue;
        }
        rows.push(structuredClone(product));
        count++;
      }
      return { count };
    });
    return { rows, createMany, prisma: { product: { createMany } } as unknown as PrismaClient };
  }

  it('creates the initial catalog and leaves it unchanged on repeated startup', async () => {
    const db = database();
    await seedPrismaProducts(db.prisma);
    await seedPrismaProducts(db.prisma);
    expect(db.rows).toEqual(seedProducts);
    expect(db.createMany).toHaveBeenCalledWith({ data: seedProducts, skipDuplicates: true });
  });

  it('preserves edits and depleted inventory while adding missing products', async () => {
    const edited = { ...seedProducts[0], inventory: 0, active: false, price: 4500, salePrice: 3000, saleActive: true, title: 'Edited title', description: 'Edited description', image: 'https://example.test/edited.png', tags: ['edited'] };
    const db = database([edited]);
    await seedPrismaProducts(db.prisma);
    await seedPrismaProducts(db.prisma);
    expect(db.rows).toEqual([edited, ...seedProducts.slice(1)]);
  });

  it('does not restore an old slug or fail when a seeded product was renamed', async () => {
    const renamed = { ...seedProducts[0], slug: 'renamed-listing' };
    const db = database([renamed]);
    await seedPrismaProducts(db.prisma);
    expect(db.rows).toEqual([renamed, ...seedProducts.slice(1)]);
  });
});
