/** Audit log: who signed in, viewed, exported or changed what. */
import { listAuditEvents } from '@aiv/pipeline';
import { requireRole } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { Card, PageHeader, Pill } from '@/components/ui';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; action?: string }>;
}) {
  const user = await requireRole(['IT']);
  const q = await searchParams;
  const events = await listAuditEvents(user.tenantId, {
    actor: q.actor || undefined,
    action: q.action || undefined,
    take: 500,
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        subtitle="Every sign-in, page view, export, setting change, vendor grant and telemetry send. Append-only; never contains file content."
      />
      <Card>
        <form className="mb-4 flex flex-wrap gap-2 text-sm">
          <input
            name="actor"
            defaultValue={q.actor}
            placeholder="Actor email"
            className="rounded-md border border-slate-300 px-2 py-1"
          />
          <select
            name="action"
            defaultValue={q.action ?? ''}
            className="rounded-md border border-slate-300 bg-white px-2 py-1"
          >
            <option value="">All actions</option>
            <option value="auth">Sign-ins</option>
            <option value="page.view">Page views</option>
            <option value="export">Exports</option>
            <option value="policy">Policy changes</option>
            <option value="settings">Settings</option>
            <option value="vendor">Vendor access</option>
            <option value="telemetry">Telemetry</option>
            <option value="scan">Scanning</option>
          </select>
          <button className="rounded-md bg-slate-900 px-3 py-1 text-white">Filter</button>
        </form>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3">When</th>
              <th className="py-2 pr-3">Who</th>
              <th className="py-2 pr-3">Action</th>
              <th className="py-2 pr-3">What</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-b border-slate-100 align-top">
                <td className="whitespace-nowrap py-1.5 pr-3 text-xs text-slate-500">
                  {dateTime(e.at)}
                </td>
                <td className="py-1.5 pr-3">
                  {e.actor}{' '}
                  {e.actorRole ? (
                    <Pill tone={e.actorRole === 'VENDOR_SUPPORT' ? 'amber' : 'slate'}>
                      {e.actorRole}
                    </Pill>
                  ) : null}
                </td>
                <td className="py-1.5 pr-3 font-mono text-xs">{e.action}</td>
                <td className="py-1.5 pr-3 text-slate-700">
                  {e.target}
                  {e.detail ? (
                    <div className="max-w-xl truncate font-mono text-[11px] text-slate-500">
                      {JSON.stringify(e.detail)}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No events.</p>
        ) : null}
      </Card>
    </div>
  );
}
