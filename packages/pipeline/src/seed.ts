/**
 * Demo seed: creates the "Harbourview Group" tenant, three app users (one per
 * role), a demo connector instance, runs a sync + analysis, and back-fills
 * eight weeks of SIMULATED history so trend charts have data.
 *
 * Idempotent: re-running replaces the demo tenant.
 */
import bcrypt from 'bcryptjs';
import { generateDemoBatch } from '@aiv/connectors';
import { deleteTenant, prisma } from '@aiv/db';
import { runTenantAnalysis } from './analyse';
import { runConnectorSync } from './sync';

export const DEMO_TENANT_SLUG = 'harbourview-demo';
/** Remediation progress of the demo "today" (some fixes already done → improving trend). */
const DEMO_PROGRESS_TODAY = 0.3;

export async function seedDemo(opts: { password?: string } = {}): Promise<{ tenantId: string }> {
  const password = opts.password ?? process.env.DEMO_PASSWORD ?? 'demo1234';
  const existing = await prisma.tenant.findUnique({ where: { slug: DEMO_TENANT_SLUG } });
  if (existing) await deleteTenant(prisma, existing.id);

  const tenant = await prisma.tenant.create({
    data: { name: 'Harbourview Group (demo)', slug: DEMO_TENANT_SLUG },
  });
  const hash = await bcrypt.hash(password, 10);
  await prisma.appUser.deleteMany({
    where: { email: { in: ['it@demo.local', 'exec@demo.local', 'manager@demo.local'] } },
  });
  await prisma.appUser.createMany({
    data: [
      {
        tenantId: tenant.id,
        email: 'it@demo.local',
        name: 'Ira Tech (IT)',
        role: 'IT',
        passwordHash: hash,
      },
      {
        tenantId: tenant.id,
        email: 'exec@demo.local',
        name: 'Erin Exec (CEO)',
        role: 'EXECUTIVE',
        passwordHash: hash,
      },
      {
        tenantId: tenant.id,
        email: 'manager@demo.local',
        name: 'Max Manager (Finance)',
        role: 'MANAGER',
        department: 'Finance',
        passwordHash: hash,
      },
    ],
  });

  const instance = await prisma.connectorInstance.create({
    data: {
      tenantId: tenant.id,
      connectorId: 'demo',
      displayName: 'Demo organisation',
      config: { seed: 42, remediationProgress: DEMO_PROGRESS_TODAY },
    },
  });

  // Simulated history: weeks 8..1 ago, with less remediation the further back we go.
  const now = new Date();
  for (let weeksAgo = 8; weeksAgo >= 1; weeksAgo--) {
    const asOf = new Date(now.getTime() - weeksAgo * 7 * 86_400_000);
    const progress = DEMO_PROGRESS_TODAY * (1 - weeksAgo / 8);
    const batch = generateDemoBatch({ seed: 42, remediationProgress: progress, asOf });
    await runTenantAnalysis(tenant.id, { batch, asOf, simulated: true, createdAt: asOf });
  }

  const sync = await runConnectorSync(tenant.id, instance.id);
  if (!sync.ok) throw new Error(`Demo sync failed: ${sync.error}`);
  await runTenantAnalysis(tenant.id);
  return { tenantId: tenant.id };
}
