/**
 * Worker CLI.
 *
 *   seed-demo                         Create/refresh the demo tenant with data + analysis.
 *   sync-all                          Sync every connector of every tenant, then analyse.
 *   loop                              Run sync-all every SYNC_INTERVAL_MINUTES (default 360).
 *   create-tenant --name "Acme Ltd" --slug acme --admin-email it@acme.com
 *                 --admin-name "Acme IT" --admin-password '<12+ chars>' [--connector microsoft-graph]
 *   add-user --tenant acme --email ceo@acme.com --name "CEO" --role EXECUTIVE --password '<12+ chars>' [--department Finance]
 *   check --tenant acme               Verify connector credentials/permissions (no data pulled).
 *   sync --tenant acme                Sync + analyse one tenant.
 *   analyse --tenant acme             Re-run analysis only (e.g. after a policy change; no re-scan).
 *   policy-import --tenant acme --file policy.yaml   Validate + set the tenant's classification policy.
 *   policy-export --tenant acme [--file out.yaml]    Print/save the active policy (sample if none).
 *   policy-sample [--file out.yaml]                  Print/save the NZ sample policy.
 *   policy-draft --tenant acme --file "Info Mgmt Policy.docx"
 *                                     Draft rules from a policy document for review in Settings → Policy.
 *   vendor-revoke-all --tenant acme   Emergency: switch vendor access off and revoke every grant.
 *
 * Environment is read from the repo-root .env when present.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isRole } from '@aiv/core';
import { prisma } from '@aiv/db';
import { NZ_PSR_SAMPLE_POLICY, policyToYaml } from '@aiv/policy';
import {
  addAppUser,
  checkConnectors,
  createTenant,
  draftPolicyFromDocument,
  getTenantPolicy,
  runConnectorSync,
  runTenantAnalysis,
  saveTenantPolicy,
  seedDemo,
  setVendorAccessEnabled,
} from '@aiv/pipeline';

const CLI_ACTOR = { email: `cli:${process.env.USER ?? 'operator'}`, role: 'CLI' };

async function tenantBySlug(slug: string | undefined) {
  return prisma.tenant.findUniqueOrThrow({ where: { slug: need(slug, 'tenant') } });
}

function output(text: string, file: string | undefined) {
  if (file) {
    writeFileSync(file, text);
    console.info(`[worker] written ${file}`);
  } else process.stdout.write(text);
}

const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

async function syncTenant(tenantId: string, slug: string): Promise<void> {
  const connectors = await prisma.connectorInstance.findMany({ where: { tenantId } });
  let anyOk = false;
  for (const c of connectors) {
    console.info(`[worker] syncing ${slug}/${c.connectorId} (${c.displayName})`);
    const out = await runConnectorSync(tenantId, c.id);
    console.info(`[worker]   -> ${out.ok ? 'ok' : `error: ${out.error}`}`, out.stats);
    for (const w of out.warnings) console.warn(`[worker]   warning: ${w}`);
    anyOk ||= out.ok;
  }
  // Don't publish an analysis of empty data (it would show a misleading "risk 0").
  if (!anyOk) {
    console.warn(`[worker] no successful sync for ${slug}; analysis skipped`);
    return;
  }
  const { result } = await runTenantAnalysis(tenantId);
  console.info(
    `[worker] analysed ${slug}: risk ${result.scores.riskScore}, value ${result.scores.valueScore}, ${result.findings.length} findings`,
  );
}

async function syncAll(): Promise<void> {
  for (const t of await prisma.tenant.findMany()) await syncTenant(t.id, t.slug);
}

function need(v: string | undefined, flag: string): string {
  if (!v) throw new Error(`Missing --${flag}`);
  return v;
}

async function main(): Promise<void> {
  const [cmd = 'sync-all', ...rest] = process.argv.slice(2);
  const { values: a } = parseArgs({
    args: rest,
    options: {
      name: { type: 'string' },
      slug: { type: 'string' },
      tenant: { type: 'string' },
      'admin-email': { type: 'string' },
      'admin-name': { type: 'string' },
      'admin-password': { type: 'string' },
      connector: { type: 'string', multiple: true },
      email: { type: 'string' },
      role: { type: 'string' },
      password: { type: 'string' },
      department: { type: 'string' },
      file: { type: 'string' },
    },
  });

  switch (cmd) {
    case 'seed-demo': {
      const { tenantId } = await seedDemo();
      console.info(
        `[worker] demo tenant ready (${tenantId}). Sign in as it@demo.local / exec@demo.local / manager@demo.local`,
      );
      break;
    }
    case 'sync-all':
      await syncAll();
      break;
    case 'loop': {
      const minutes = Number(process.env.SYNC_INTERVAL_MINUTES ?? 360);
      for (;;) {
        await syncAll().catch((e) => console.error('[worker] sync-all failed', e));
        await new Promise((r) => setTimeout(r, minutes * 60_000));
      }
    }
    case 'create-tenant': {
      const { tenantId } = await createTenant({
        name: need(a.name, 'name'),
        slug: need(a.slug, 'slug'),
        admin: {
          email: need(a['admin-email'], 'admin-email'),
          name: a['admin-name'] ?? 'IT admin',
          password: need(a['admin-password'], 'admin-password'),
        },
        connectors: a.connector ?? ['microsoft-graph'],
      });
      console.info(`[worker] tenant created: ${tenantId}`);
      break;
    }
    case 'add-user': {
      const role = need(a.role, 'role').toUpperCase();
      if (!isRole(role) || role === 'VENDOR_SUPPORT')
        throw new Error(
          '--role must be IT, EXECUTIVE or MANAGER (vendor access is granted in Settings → Vendor access)',
        );
      await addAppUser(need(a.tenant, 'tenant'), {
        email: need(a.email, 'email'),
        name: a.name ?? a.email!,
        password: need(a.password, 'password'),
        role,
        department: a.department,
      });
      console.info('[worker] user added');
      break;
    }
    case 'check': {
      for (const { connector, result } of await checkConnectors(need(a.tenant, 'tenant'))) {
        console.info(`[worker] ${connector}: ${result.ok ? 'OK' : 'PROBLEM'} — ${result.message}`);
      }
      break;
    }
    case 'sync': {
      const t = await prisma.tenant.findUniqueOrThrow({
        where: { slug: need(a.tenant, 'tenant') },
      });
      await syncTenant(t.id, t.slug);
      break;
    }
    case 'analyse': {
      const t = await tenantBySlug(a.tenant);
      const { result } = await runTenantAnalysis(t.id);
      console.info(
        `[worker] analysed ${t.slug}: risk ${result.scores.riskScore}, ${result.findings.length} findings, ` +
          `${result.content?.breachingFiles ?? 0} files breaching policy`,
      );
      break;
    }
    case 'policy-import': {
      const t = await tenantBySlug(a.tenant);
      const out = await saveTenantPolicy(
        t.id,
        readFileSync(need(a.file, 'file'), 'utf8'),
        CLI_ACTOR,
      );
      if (!out.ok) {
        for (const e of out.errors) console.error(`  ✗ ${e}`);
        throw new Error('Policy not imported.');
      }
      for (const w of out.warnings) console.warn(`  ! ${w}`);
      console.info(
        `[worker] policy "${out.policy.name}" v${out.policy.version} imported. Run 'analyse --tenant ${t.slug}' to re-evaluate.`,
      );
      break;
    }
    case 'policy-export': {
      const t = await tenantBySlug(a.tenant);
      const { policy, source } = await getTenantPolicy(t.id);
      if (source === 'sample')
        console.warn('[worker] no tenant policy set — exporting the NZ sample');
      output(policyToYaml(policy), a.file);
      break;
    }
    case 'policy-sample':
      output(policyToYaml(NZ_PSR_SAMPLE_POLICY), a.file);
      break;
    case 'policy-draft': {
      const t = await tenantBySlug(a.tenant);
      const file = need(a.file, 'file');
      const out = await draftPolicyFromDocument(
        t.id,
        { name: file.split(/[\\/]/).pop()!, bytes: new Uint8Array(readFileSync(file)) },
        CLI_ACTOR,
      );
      if (!out.ok) throw new Error(out.error);
      for (const n of out.result.notes) console.info(`  - ${n}`);
      console.info(
        `[worker] draft ${out.draftId} created (${out.result.method}); review it in Settings → Policy.`,
      );
      break;
    }
    case 'vendor-revoke-all': {
      const t = await tenantBySlug(a.tenant);
      await setVendorAccessEnabled(t.id, false, CLI_ACTOR);
      console.info('[worker] vendor access disabled and all grants revoked');
      break;
    }
    default:
      throw new Error(`Unknown command '${cmd}'`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
