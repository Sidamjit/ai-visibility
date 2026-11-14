/** Public surface of @aiv/db. */
export { prisma } from './client';
export {
  saveBatch,
  loadBatch,
  deleteTenant,
  loadKnownContentVersions,
  type ContentScanScope,
} from './entities';
export { Prisma } from '@prisma/client';
export type { PrismaClient } from '@prisma/client';
