import { assertProductionDatabase } from './productionConfig.js';
import { PrismaClient } from '@prisma/client';
import { createInMemoryStore } from './store.js';
import { retireListings, seedCatalogueListings } from './catalogue.js';
import { createPrismaStore, seedPrismaContent, seedPrismaProducts } from './prismaStore.js';
import type { Store } from './types.js';

export async function createStoreFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<{ store: Store; disconnect?: () => Promise<void> }> {
  assertProductionDatabase(env);
  if (!env.DATABASE_URL) return { store: createInMemoryStore() };

  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  await seedPrismaProducts(prisma);
  // The real catalogue, then the placeholders taken off display. Both are idempotent and
  // non-destructive: existing listings are never overwritten, so edits made in /admin survive
  // a redeploy or a restart.
  await seedCatalogueListings(prisma);
  await seedPrismaContent(prisma);
  await retireListings(prisma);
  return {
    store: createPrismaStore(prisma),
    disconnect: () => prisma.$disconnect()
  };
}
