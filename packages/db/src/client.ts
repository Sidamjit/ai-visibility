/**
 * Prisma client singleton. In Next.js dev, hot reload would otherwise create a
 * new client (and connection pool) on every change.
 */
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __aivPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__aivPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === '1' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.__aivPrisma = prisma;
