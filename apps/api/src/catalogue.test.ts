import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { RETIRED_LISTING_SLUGS, catalogueListings, retireListings, seedCatalogueListings } from './catalogue.js';

type CreateManyArgs = { data: unknown[]; skipDuplicates?: boolean };
type UpdateManyArgs = { where: { slug: { in: string[] }; active: boolean }; data: { active: boolean } };

function fakePrisma() {
  const createMany = vi.fn(async (_args: CreateManyArgs) => ({ count: 0 }));
  const updateMany = vi.fn(async (_args: UpdateManyArgs) => ({ count: 0 }));
  return { prisma: { product: { createMany, updateMany } } as unknown as PrismaClient, createMany, updateMany };
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe('the committed catalogue', () => {
  it('is not empty and looks complete', () => {
    expect(catalogueListings.length).toBeGreaterThanOrEqual(100);
  });

  it('has a unique slug and id for every listing', () => {
    const slugs = catalogueListings.map((p) => p.slug);
    const ids = catalogueListings.map((p) => p.id);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every slug satisfies the API slug pattern', () => {
    for (const p of catalogueListings) expect(p.slug).toMatch(SLUG_RE);
  });

  it('every listing is complete enough to sell', () => {
    for (const p of catalogueListings) {
      expect(p.title.trim(), p.slug).not.toBe('');
      expect(p.description.trim(), p.slug).not.toBe('');
      expect(p.category.trim(), p.slug).not.toBe('');
      expect(p.image, p.slug).toMatch(/^https:\/\//);
      expect(Number.isInteger(p.price) && p.price >= 0, p.slug).toBe(true);
      expect(Number.isInteger(p.inventory) && p.inventory >= 0, p.slug).toBe(true);
      expect(p.tags.length, p.slug).toBeGreaterThan(0);
      expect(p.tags.every((t) => t.trim() !== ''), p.slug).toBe(true);
    }
  });

  it('never contains a listing that is meant to be retired', () => {
    for (const slug of RETIRED_LISTING_SLUGS) {
      expect(catalogueListings.some((p) => p.slug === slug), slug).toBe(false);
    }
  });

  // The whole reason descriptions are generated instead of copied from the ETF export.
  it('does not repeat one description across the catalogue', () => {
    const distinct = new Set(catalogueListings.map((p) => p.description));
    expect(distinct.size).toBe(catalogueListings.length);
  });

  it('carries every listing as available to buy', () => {
    expect(catalogueListings.every((p) => p.active)).toBe(true);
  });
});

describe('RETIRED_LISTING_SLUGS', () => {
  it('covers the four seed placeholders', () => {
    for (const slug of [
      'golden-hour-commander-proxy',
      'midnight-token-pack',
      'velvet-archive-display-card',
      'social-link-land-set',
    ]) expect(RETIRED_LISTING_SLUGS).toContain(slug);
  });

  it('covers the live test listing', () => {
    expect(RETIRED_LISTING_SLUGS).toContain('great');
  });

  it('does not retire anything from the real catalogue', () => {
    const catalogueSlugs = new Set(catalogueListings.map((p) => p.slug));
    expect(RETIRED_LISTING_SLUGS.filter((s) => catalogueSlugs.has(s))).toEqual([]);
  });
});

describe('seedCatalogueListings', () => {
  // Create-only is the safety property: a redeploy must not revert an edit made in /admin.
  it('inserts with skipDuplicates so existing rows are never overwritten', async () => {
    const { prisma, createMany } = fakePrisma();
    await seedCatalogueListings(prisma);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0][0].skipDuplicates).toBe(true);
    expect(createMany.mock.calls[0][0].data).toHaveLength(catalogueListings.length);
  });

  it('does not touch the database when there is nothing to seed', async () => {
    const { prisma, createMany } = fakePrisma();
    const result = await seedCatalogueListings(prisma, []);
    expect(createMany).not.toHaveBeenCalled();
    expect(result).toEqual({ count: 0 });
  });
});

describe('retireListings', () => {
  it('deactivates only rows that are still active', async () => {
    const { prisma, updateMany } = fakePrisma();
    await retireListings(prisma);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ slug: { in: RETIRED_LISTING_SLUGS }, active: true });
    expect(arg.data).toEqual({ active: false });
  });

  // Deleting would fail or destroy order history, because OrderItem references Product.
  it('never deletes a product', async () => {
    const { prisma } = fakePrisma();
    const spy = vi.fn();
    Object.assign(prisma.product, { deleteMany: spy, delete: spy });
    await retireListings(prisma);
    expect(spy).not.toHaveBeenCalled();
  });

  it('accepts an explicit list', async () => {
    const { prisma, updateMany } = fakePrisma();
    await retireListings(prisma, ['only-this']);
    expect(updateMany.mock.calls[0][0].where.slug.in).toEqual(['only-this']);
  });
});
