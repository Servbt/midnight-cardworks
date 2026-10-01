import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { seedPrismaProducts } from './prismaStore.js';
import { seedProducts } from './seed.js';
import type { Product } from './types.js';

describe('startup product seeding', () => {
  it('inserts missing listings and preserves edits on repeated startup, including ID and slug collisions', async () => {
    const edited = { ...seedProducts[0], title: 'My edited title', price: 900, image: 'https://shop.example/my-image.png', inventory: 2, active: false, saleActive: true, salePrice: 700 };
    const renamed = { ...seedProducts[1], slug: 'renamed-listing', inventory: 1 };
    const replaced = { ...seedProducts[2], id: 'replacement-id', title: 'Replacement listing' };
    const rows: Product[] = [edited, renamed, replaced];
    // Model PostgreSQL skipDuplicates on BOTH unique keys; reject any attempt to update a row.
    const createMany = vi.fn(async ({ data, skipDuplicates }: { data: Product[]; skipDuplicates: boolean }) => {
      expect(skipDuplicates).toBe(true);
      for (const product of data) {
        if (!rows.some((row) => row.id === product.id || row.slug === product.slug)) rows.push({ ...product });
      }
      return { count: rows.length };
    });
    const client = { product: { createMany, upsert: () => { throw new Error('Startup must not update existing listings'); } } } as unknown as PrismaClient;
    const missing = { ...seedProducts[0], id: 'missing-id', slug: 'missing-listing' };
    await seedPrismaProducts(client, [...seedProducts, missing]);
    const afterFirstStart = structuredClone(rows);
    await seedPrismaProducts(client, [...seedProducts, missing]);
    expect(rows).toEqual(afterFirstStart);
    expect(rows.find((row) => row.id === edited.id)).toEqual(edited);
    expect(rows.find((row) => row.id === renamed.id)).toEqual(renamed);
    expect(rows.find((row) => row.slug === replaced.slug)).toEqual(replaced);
    expect(rows.filter((row) => row.id === missing.id)).toEqual([missing]);
  });
});
