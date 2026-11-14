/** Public surface of @aiv/db. */
export { prisma } from './client';
export { saveBatch, loadBatch, deleteTenant } from './entities';
export type { Prisma, PrismaClient } from '@prisma/client';
