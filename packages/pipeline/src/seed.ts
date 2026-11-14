/**
 * Demo seed: creates the "Harbourview Group" tenant, three app users (one per
 * role), a demo connector instance, runs a sync + analysis, and back-fills
 * eight weeks of SIMULATED history so trend charts have data.
 *
 * Idempotent: re-running replaces the demo tenant.
 */
import bcrypt from 'bcryptjs';
import { generateDemoBatch } from '@aiv/connectors';
import { deleteTenant, prisma, type Prisma } from '@aiv/db';
import { NZ_PSR_SAMPLE_POLICY, PolicySchema } from '@aiv/policy';
import { runTenantAnalysis } from './analyse';
import { runConnectorSync } from './sync';

export const DEMO_TENANT_SLUG = 'harbourview-demo';
/** Remediation progress of the demo "today" (some fixes already done → improving trend). */
const DEMO_PROGRESS_TODAY = 0.3;

export async function seedDemo(opts: { password?: string } = {}): Promise<{ tenantId: string }> {
  const password = opts.password ?? process.env.DEMO_PASSWORD ?? 'demo1234';
  const existing = await prisma.tenant.findUnique({ where: { slug: DEMO_TENANT_SLUG } });
  if (existing) await deleteTenant(prisma, existing.id);

  const policy = PolicySchema.parse(NZ_PSR_SAMPLE_POLICY);
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Harbourview Group (demo)',
      slug: DEMO_TENANT_SLUG,
      policy: policy as unknown as Prisma.InputJsonValue,
      policyUpdatedAt: new Date(),
      policyUpdatedBy: 'it@demo.local',
      // Demo shows redacted snippets so the evidence view is meaningful; real tenants default to 'off'.
      scanSettings: { snippetMode: 'redacted' },
    },
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
    await runTenantAnalysis(tenant.id, {
      batch,
      asOf,
      simulated: true,
      createdAt: asOf,
      policy,
    });
  }

  const sync = await runConnectorSync(tenant.id, instance.id);
  if (!sync.ok) throw new Error(`Demo sync failed: ${sync.error}`);
  await runTenantAnalysis(tenant.id);

  // A little audit history so the audit-log page is not empty.
  const at = (h: number) => new Date(now.getTime() - h * 3_600_000);
  await prisma.auditEvent.createMany({
    data: [
      { at: at(50), actor: 'it@demo.local', actorRole: 'IT', action: 'auth.login' },
      {
        at: at(49.9),
        actor: 'it@demo.local',
        actorRole: 'IT',
        action: 'policy.update',
        target: `${policy.name} v${policy.version}`,
      },
      { at: at(26), actor: 'exec@demo.local', actorRole: 'EXECUTIVE', action: 'auth.login' },
      {
        at: at(25.9),
        actor: 'exec@demo.local',
        actorRole: 'EXECUTIVE',
        action: 'page.view',
        target: '/executive',
      },
      {
        at: at(25.8),
        actor: 'exec@demo.local',
        actorRole: 'EXECUTIVE',
        action: 'export.report',
        target: '/report',
      },
      {
        at: at(3),
        actor: 'it@demo.local',
        actorRole: 'IT',
        action: 'page.view',
        target: '/it/breaches',
      },
      {
        at: at(2.9),
        actor: 'it@demo.local',
        actorRole: 'IT',
        action: 'export.csv',
        target: 'content-breaches.csv',
      },
    ].map((e) => ({ ...e, tenantId: tenant.id })),
  });
  return { tenantId: tenant.id };
}
