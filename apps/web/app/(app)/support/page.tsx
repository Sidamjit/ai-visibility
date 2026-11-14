/**
 * Support diagnostics: the ONLY page a 'diagnostics'-scope vendor grant opens.
 * Shows health, versions, configuration flags and sync statistics — no
 * findings, file/site/person names, policy content or secrets.
 */
import { CONNECTORS } from '@aiv/connectors';
import { prisma } from '@aiv/db';
import { createLlmClientFromEnv } from '@aiv/content-scan';
import { activeVendorGrant, telemetryEnabled } from '@aiv/pipeline';
import { requireRole } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { Card, Kpi, PageHeader, Pill } from '@/components/ui';

const ENV_FLAGS = [
  ...new Set([
    'DATABASE_URL',
    'NEXTAUTH_SECRET',
    'NEXTAUTH_URL',
    'AZURE_AD_CLIENT_ID',
    ...CONNECTORS.flatMap((c) => c.secretEnvVars),
    'LLM_PROVIDER',
    'TELEMETRY_ENABLED',
  ]),
];

function llmProvider(): string {
  try {
    return createLlmClientFromEnv(process.env)?.provider ?? 'none';
  } catch {
    return 'misconfigured';
  }
}

export default async function SupportPage() {
  const user = await requireRole(['IT']);
  const tenantId = user.tenantId;
  const [instances, runs, lastRun, scanStats, grant] = await Promise.all([
    prisma.connectorInstance.findMany({ where: { tenantId } }),
    prisma.syncRun.findMany({ where: { tenantId }, orderBy: { startedAt: 'desc' }, take: 15 }),
    prisma.analysisRun.findFirst({
      where: { tenantId, simulated: false },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.contentScan.groupBy({ by: ['status'], where: { tenantId }, _count: true }),
    user.role === 'VENDOR_SUPPORT' ? activeVendorGrant(user.id) : Promise.resolve(null),
  ]);
  const provider = process.env.DATABASE_URL?.startsWith('file:') ? 'sqlite' : 'postgresql';
  return (
    <div className="space-y-6">
      <PageHeader
        title="Support diagnostics"
        subtitle="Health and configuration for troubleshooting. Contains no findings, names or content."
      />
      {grant ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Vendor session ({grant.scope}) granted by {grant.grantedBy} — ends{' '}
          {dateTime(grant.expiresAt)}. Every page you open is recorded in the client&apos;s audit
          log.
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi
          label="App version"
          value={process.env.APP_VERSION ?? '0.1.0'}
          hint={`Node ${process.version}`}
        />
        <Kpi label="Database" value={provider} />
        <Kpi label="Last analysis" value={dateTime(lastRun?.createdAt)} />
        <Kpi
          label="Content scans"
          value={scanStats.reduce((n, s) => n + s._count, 0)}
          hint={scanStats.map((s) => `${s._count} ${s.status}`).join(' · ')}
        />
      </div>
      <Card title="Configuration (set / not set — values are never shown)">
        <div className="flex flex-wrap gap-2 text-xs">
          {ENV_FLAGS.map((k) => (
            <Pill key={k} tone={process.env[k] ? 'green' : 'slate'}>
              {k}: {process.env[k] ? 'set' : 'not set'}
            </Pill>
          ))}
          <Pill tone="blue">LLM provider: {llmProvider()}</Pill>
          <Pill tone={telemetryEnabled() ? 'amber' : 'green'}>
            telemetry: {telemetryEnabled() ? 'on' : 'off'}
          </Pill>
        </div>
      </Card>
      <Card title="Connectors">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3">Connector</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Last sync</th>
              <th className="py-2 pr-3">Stats</th>
              <th className="py-2 pr-3">Last error</th>
            </tr>
          </thead>
          <tbody>
            {instances.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-3 font-mono text-xs">{c.connectorId}</td>
                <td className="py-2 pr-3">
                  <Pill tone={c.status === 'ok' ? 'green' : c.status === 'error' ? 'red' : 'amber'}>
                    {c.status}
                  </Pill>
                </td>
                <td className="py-2 pr-3 text-xs">{dateTime(c.lastSyncAt)}</td>
                <td className="py-2 pr-3 text-xs text-slate-600">
                  {Object.entries((c.lastStats as Record<string, number> | null) ?? {})
                    .map(([k, v]) => `${k} ${v}`)
                    .join(' · ')}
                </td>
                <td className="py-2 pr-3 text-xs text-red-700">{c.lastError ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Recent sync runs">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3">Started</th>
              <th className="py-2 pr-3">Duration</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Full</th>
              <th className="py-2 pr-3">Warnings</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-b border-slate-100">
                <td className="py-1.5 pr-3 text-xs">{dateTime(r.startedAt)}</td>
                <td className="py-1.5 pr-3 text-xs">
                  {r.finishedAt
                    ? `${Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)} s`
                    : '—'}
                </td>
                <td className="py-1.5 pr-3">
                  <Pill tone={r.status === 'ok' ? 'green' : r.status === 'error' ? 'red' : 'amber'}>
                    {r.status}
                  </Pill>
                </td>
                <td className="py-1.5 pr-3 text-xs">{r.fullSync ? 'yes' : 'no'}</td>
                <td className="py-1.5 pr-3 text-xs text-slate-600">
                  {((r.warnings as string[] | null) ?? []).length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
