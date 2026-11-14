/**
 * Worker CLI.
 *
 *   tsx src/cli.ts seed-demo   Create/refresh the demo tenant with data + analysis.
 *   tsx src/cli.ts sync-all    Sync every connector instance of every tenant, then analyse.
 *   tsx src/cli.ts loop        Run sync-all every SYNC_INTERVAL_MINUTES (default 360).
 *
 * Environment is read from the repo-root .env when present.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '@aiv/db';
import { runConnectorSync, runTenantAnalysis, seedDemo } from '@aiv/pipeline';

const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

async function syncAll(): Promise<void> {
  const tenants = await prisma.tenant.findMany({ include: { connectors: true } });
  for (const t of tenants) {
    for (const c of t.connectors) {
      console.info(`[worker] syncing ${t.slug}/${c.connectorId} (${c.displayName})`);
      const out = await runConnectorSync(t.id, c.id);
      console.info(`[worker]   -> ${out.ok ? 'ok' : `error: ${out.error}`}`, out.stats);
      for (const w of out.warnings) console.warn(`[worker]   warning: ${w}`);
    }
    const { result } = await runTenantAnalysis(t.id);
    console.info(
      `[worker] analysed ${t.slug}: risk ${result.scores.riskScore}, value ${result.scores.valueScore}, ${result.findings.length} findings`,
    );
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'sync-all';
  if (cmd === 'seed-demo') {
    const { tenantId } = await seedDemo();
    console.info(
      `[worker] demo tenant ready (${tenantId}). Sign in as it@demo.local / exec@demo.local / manager@demo.local`,
    );
  } else if (cmd === 'sync-all') {
    await syncAll();
  } else if (cmd === 'loop') {
    const minutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 360);
    for (;;) {
      await syncAll().catch((e) => console.error('[worker] sync-all failed', e));
      await new Promise((r) => setTimeout(r, minutes * 60_000));
    }
  } else {
    throw new Error(`Unknown command '${cmd}'`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
