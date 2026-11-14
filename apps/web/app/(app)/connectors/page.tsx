/**
 * Connectors: configured instances (status, last sync, warnings, "sync now")
 * and the catalogue of available/planned connectors with exact permissions.
 */
import { CONNECTORS } from '@aiv/connectors';
import { prisma } from '@aiv/db';
import { requireRole } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { SubmitButton } from '@/components/SubmitButton';
import { Card, PageHeader, Pill } from '@/components/ui';
import { syncConnectorNow } from '../actions';

export default async function ConnectorsPage() {
  const user = await requireRole(['IT']);
  const instances = await prisma.connectorInstance.findMany({
    where: { tenantId: user.tenantId },
    orderBy: { createdAt: 'asc' },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connectors"
        subtitle="Read-only, metadata-only connections to your AI and content platforms. Secrets are held in environment variables, never in the database."
      />
      <Card title="Configured">
        {instances.length === 0 ? (
          <p className="text-sm text-slate-500">
            No connectors configured. See docs/PILOT_SETUP.md.
          </p>
        ) : null}
        <div className="space-y-4">
          {instances.map((c) => {
            const warnings = (c.lastWarnings as string[] | null) ?? [];
            const stats = (c.lastStats as Record<string, number> | null) ?? {};
            return (
              <div key={c.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold">{c.displayName}</span>
                  <Pill>{c.connectorId}</Pill>
                  <Pill tone={c.status === 'ok' ? 'green' : c.status === 'error' ? 'red' : 'amber'}>
                    {c.status}
                  </Pill>
                  <span className="text-xs text-slate-500">last sync {dateTime(c.lastSyncAt)}</span>
                  <form action={syncConnectorNow} className="ml-auto">
                    <input type="hidden" name="connectorInstanceId" value={c.id} />
                    <SubmitButton pendingText="Syncing…">Sync now</SubmitButton>
                  </form>
                </div>
                {Object.keys(stats).length ? (
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
                    {Object.entries(stats).map(([k, v]) => (
                      <span key={k}>
                        {k}: <b>{v}</b>
                      </span>
                    ))}
                  </div>
                ) : null}
                {c.lastError ? <p className="mt-2 text-sm text-red-600">{c.lastError}</p> : null}
                {warnings.map((w) => (
                  <p key={w} className="mt-1 text-xs text-amber-700">
                    ⚠ {w}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      </Card>
      <Card title="Catalogue">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {CONNECTORS.map((c) => (
            <div key={c.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{c.displayName}</span>
                <Pill
                  tone={
                    c.maturity === 'available'
                      ? 'green'
                      : c.maturity === 'preview'
                        ? 'amber'
                        : 'slate'
                  }
                >
                  {c.maturity}
                </Pill>
              </div>
              <p className="mt-1 text-sm text-slate-600">{c.description}</p>
              {c.requiredPermissions.length ? (
                <table className="mt-2 min-w-full text-xs">
                  <tbody>
                    {c.requiredPermissions.map((p) => (
                      <tr key={p.name} className="border-t border-slate-100 align-top">
                        <td className="py-1 pr-2 font-mono">{p.name}</td>
                        <td className="py-1 pr-2 text-slate-500">{p.type}</td>
                        <td className="py-1 text-slate-600">
                          {p.reason}
                          {!p.required ? ' (optional)' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
