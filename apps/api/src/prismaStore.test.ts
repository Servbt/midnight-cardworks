import { describe, expect, it } from 'vitest';
import { createPrismaStore } from './prismaStore.js';

describe('Prisma storage wiring', () => {
  it('exports a Prisma-backed store adapter for production persistence', () => {
    expect(typeof createPrismaStore).toBe('function');
  });
});
