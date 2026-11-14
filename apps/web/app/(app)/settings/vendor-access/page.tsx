/**
 * Vendor support access: OFF by default. The client admin can grant the app
 * vendor a time-boxed, scoped login and revoke it at any time. All vendor
 * activity is in the audit log.
 */
import { prisma } from '@aiv/db';
import { MAX_VENDOR_GRANT_HOURS, listVendorGrants } from '@aiv/pipeline';
import { requireRole } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { Card, PageHeader, Pill } from '@/components/ui';
import { SubmitButton } from '@/components/SubmitButton';
import { VendorGrantForm } from '@/components/settings/VendorGrantForm';
import { revokeVendorGrantAction, toggleVendorAccessAction } from '../actions';

export default async function VendorAccessPage() {
  const user = await requireRole(['IT']);
  const [tenant, grants] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
    listVendorGrants(user.tenantId),
  ]);
  const now = Date.now();
  const status = (g: (typeof grants)[number]) =>
    g.revokedAt
      ? 'revoked'
      : g.expiresAt.getTime() <= now
        ? 'expired'
        : tenant.vendorAccessEnabled
          ? 'active'
          : 'suspended';
  const vendorEvents = await prisma.auditEvent.findMany({
    where: { tenantId: user.tenantId, actorRole: 'VENDOR_SUPPORT' },
    orderBy: { at: 'desc' },
    take: 20,
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendor support access"
        subtitle="The app vendor has no access to this deployment, its data or its findings unless you grant it here."
      />
      <Card title="Master switch">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm">
            Vendor access is{' '}
            <Pill tone={tenant.vendorAccessEnabled ? 'amber' : 'green'}>
              {tenant.vendorAccessEnabled ? 'allowed (with a grant)' : 'off'}
            </Pill>
            <p className="mt-1 max-w-2xl text-xs text-slate-500">
              While off, no vendor account can sign in even with a valid grant. Turning it off
              revokes every active grant immediately.
            </p>
          </div>
          <form action={toggleVendorAccessAction}>
            <input
              type="hidden"
              name="enabled"
              value={tenant.vendorAccessEnabled ? 'false' : 'true'}
            />
            <SubmitButton pendingText="Saving…">
              {tenant.vendorAccessEnabled ? 'Turn off and revoke all' : 'Allow time-boxed grants'}
            </SubmitButton>
          </form>
        </div>
      </Card>
      {tenant.vendorAccessEnabled ? (
        <Card title="Grant access">
          <VendorGrantForm maxHours={MAX_VENDOR_GRANT_HOURS} />
        </Card>
      ) : null}
      <Card title="Grants">
        {grants.length === 0 ? (
          <p className="text-sm text-slate-500">No grants have ever been issued.</p>
        ) : null}
        {grants.length ? (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3">Vendor</th>
                <th className="py-2 pr-3">Scope</th>
                <th className="py-2 pr-3">Reason</th>
                <th className="py-2 pr-3">Granted</th>
                <th className="py-2 pr-3">Expires</th>
                <th className="py-2 pr-3">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3">{g.email}</td>
                  <td className="py-2 pr-3">{g.scope}</td>
                  <td className="py-2 pr-3 text-slate-600">{g.reason}</td>
                  <td className="py-2 pr-3 text-xs">
                    {dateTime(g.grantedAt)} by {g.grantedBy}
                  </td>
                  <td className="py-2 pr-3 text-xs">{dateTime(g.expiresAt)}</td>
                  <td className="py-2 pr-3">
                    <Pill tone={status(g) === 'active' ? 'amber' : 'slate'}>{status(g)}</Pill>
                  </td>
                  <td className="py-2 pr-3">
                    {status(g) === 'active' ? (
                      <form action={revokeVendorGrantAction}>
                        <input type="hidden" name="grantId" value={g.id} />
                        <SubmitButton pendingText="Revoking…">Revoke now</SubmitButton>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
      <Card title="Recent vendor activity">
        {vendorEvents.length === 0 ? (
          <p className="text-sm text-slate-500">No vendor activity recorded.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {vendorEvents.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="w-32 shrink-0 text-xs text-slate-500">{dateTime(e.at)}</span>
                <span className="font-mono text-xs">{e.action}</span>
                <span className="text-slate-600">{e.target}</span>
                <span className="text-xs text-slate-500">{e.actor}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
