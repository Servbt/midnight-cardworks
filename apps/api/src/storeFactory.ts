import { PrismaClient } from '@prisma/client';
import { createInMemoryStore } from './store.js';
import { createPrismaStore, seedPrismaContent, seedPrismaProducts } from './prismaStore.js';
import type { Store } from './types.js';

export async function createStoreFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<{ store: Store; disconnect?: () => Promise<void> }> {
  if (!env.DATABASE_URL) return { store: createInMemoryStore() };

  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  await seedPrismaProducts(prisma);
  await seedPrismaContent(prisma);
  return {
    store: createPrismaStore(prisma),
    disconnect: () => prisma.$disconnect()
  };
}
