/**
 * Demo connector: emits synthetic data for a fictional organisation so the app
 * can be evaluated, demoed to prospects and developed without a real tenant.
 * It follows the exact same contract as real connectors.
 */
import { z } from 'zod';
import type { Connector } from '../types';
import { generateDemoBatch } from './generate';

export const demoConfigSchema = z.object({
  seed: z.number().int().default(42),
  remediationProgress: z.number().min(0).max(1).default(0),
});
export type DemoConfig = z.infer<typeof demoConfigSchema>;

export const demoConnector: Connector<DemoConfig> = {
  id: 'demo',
  displayName: 'Demo organisation (synthetic data)',
  vendor: 'Built-in',
  description:
    'Generates realistic Microsoft 365 / Copilot / SharePoint data for "Harbourview Group". No credentials needed.',
  maturity: 'available',
  requiredPermissions: [],
  secretEnvVars: [],
  configSchema: demoConfigSchema as z.ZodType<DemoConfig>,
  async authenticate() {
    return { ok: true, message: 'Demo connector needs no credentials.' };
  },
  async sync(ctx) {
    const config = demoConfigSchema.parse(ctx.config ?? {});
    const asOf = (ctx.now ?? (() => new Date()))();
    const batch = generateDemoBatch({
      seed: config.seed,
      remediationProgress: config.remediationProgress,
      asOf,
    });
    return {
      batch,
      nextCursor: { generatedAt: asOf.toISOString() },
      fullSync: true,
      deletions: { locations: [], grants: [] },
      stats: {
        identities: batch.identities.length,
        locations: batch.locations.length,
        grants: batch.grants.length,
      },
      warnings: [],
    };
  },
};
