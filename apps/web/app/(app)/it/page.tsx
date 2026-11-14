/**
 * ICT / IT dashboard: exposure detail, findings with filters, per-site
 * readiness (links to drill-down), and links to remediation + CSV export.
 */
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { getFindings, getLatestRun } from '@/lib/data';
import { date } from '@/lib/format';
import { SeverityDonut, SimpleBarChart } from '@/components/charts';
import { FindingsTable } from '@/components/FindingsTable';
import { ButtonLink, Card, EmptyState, Kpi, PageHeader, Pill, ProgressBar } from '@/components/ui';
import { rerunAnalysis } from '../actions';
import { SubmitButton } from '@/components/SubmitButton';

export default async function ItDashboard() {
  const user = await requireRole(['IT']);
  const run = await getLatestRun(user.tenantId);
  if (!run)
    return (
      <EmptyState
        title="No analysis yet"
        body="Add a connector (or the demo connector) and run a sync."
        href="/connectors"
        cta="Go to connectors"
      />
    );
  const findings = await getFindings(user.tenantId, run.id);
  const m = run.metrics;
  const severityCounts = findings.reduce<Record<string, number>>(
    (acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }),
    {},
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="ICT dashboard"
        subtitle={`Exposure, oversharing and Copilot readiness · analysis ${date(run.createdAt)}`}
        actions={
          <>
            <a
              href="/api/findings/export"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Export CSV
            </a>
            <ButtonLink href="/it/remediation">Remediation checklist</ButtonLink>
            <form action={rerunAnalysis}>
              <SubmitButton pendingText="Analysing…">Re-run analysis</SubmitButton>
            </form>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Sites analysed" value={m.sites} hint={`${m.publicSites} public`} />
        <Kpi label="Anyone links" value={m.anyoneLinks} tone={m.anyoneLinks ? 'bad' : 'good'} />
        <Kpi label="Org-wide links" value={m.orgLinks} tone={m.orgLinks ? 'warn' : 'good'} />
        <Kpi
          label="Guest grants"
          value={m.externalGrants}
          hint={`${m.guestUsers} guest accounts`}
          tone={m.externalGrants ? 'warn' : 'good'}
        />
        <Kpi label="Sensitive items" value={m.sensitiveLocations} hint="metadata signals" />
        <Kpi
          label="Unlabelled sensitive"
          value={m.unlabeledSensitive}
          tone={m.unlabeledSensitive ? 'bad' : 'good'}
        />
        <Kpi label="Broken inheritance" value={m.uniquePermissionItems} />
        <Kpi
          label="Stale sites"
          value={m.staleSites}
          hint={`> ${run.assumptions.staleContentDays} days`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Exposure by type">
          <SimpleBarChart
            height={240}
            data={[
              { name: 'Anyone links', count: m.anyoneLinks },
              { name: 'Org-wide links', count: m.orgLinks },
              { name: 'Guest grants', count: m.externalGrants },
              { name: 'Unique perms', count: m.uniquePermissionItems },
              { name: 'Unlabelled sens.', count: m.unlabeledSensitive },
            ]}
            bars={[{ key: 'count', label: 'Count', color: '#f97316' }]}
          />
        </Card>
        <Card title="Findings by severity">
          <SeverityDonut counts={severityCounts} />
        </Card>
        <Card title="Least Copilot-ready sites">
          <SimpleBarChart
            layout="vertical"
            height={240}
            data={run.siteScores
              .slice(0, 8)
              .map((s) => ({ name: s.name.slice(0, 22), readiness: s.readiness }))}
            bars={[{ key: 'readiness', label: 'Readiness', color: '#0284c7' }]}
          />
        </Card>
      </div>

      <Card title={`Findings (${findings.length})`}>
        <FindingsTable
          rows={findings.map((f) => ({
            id: f.id,
            ruleId: f.ruleId,
            severity: f.severity,
            category: f.category,
            kind: f.kind,
            title: f.title,
            summary: f.summary,
            siteExternalId: f.siteExternalId,
            departmentName: f.departmentName,
            affectedCount: f.affectedCount,
            fix: f.recommendation?.title ?? null,
          }))}
        />
      </Card>

      <Card title="Sites — Copilot readiness">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3">Site</th>
                <th className="py-2 pr-3">Department</th>
                <th className="py-2 pr-3">Visibility</th>
                <th className="py-2 pr-3 text-right">Members</th>
                <th className="py-2 pr-3 text-right">Sensitive</th>
                <th className="py-2 pr-3 text-right">Anyone</th>
                <th className="py-2 pr-3 text-right">Org</th>
                <th className="py-2 pr-3 text-right">Guests</th>
                <th className="w-48 py-2 pr-3">Readiness</th>
              </tr>
            </thead>
            <tbody>
              {run.siteScores.map((s) => (
                <tr key={s.siteExternalId} className="border-b border-slate-100">
                  <td className="py-2 pr-3">
                    <Link
                      className="font-medium hover:underline"
                      href={`/it/sites/${encodeURIComponent(s.siteExternalId)}`}
                    >
                      {s.name}
                    </Link>
                    {s.stale ? (
                      <span className="ml-2">
                        <Pill tone="amber">stale</Pill>
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{s.department ?? '—'}</td>
                  <td className="py-2 pr-3">
                    <Pill tone={s.visibility === 'public' ? 'red' : 'slate'}>{s.visibility}</Pill>
                  </td>
                  <td className="py-2 pr-3 text-right">{s.memberCount ?? '—'}</td>
                  <td className="py-2 pr-3 text-right">{s.sensitiveItems}</td>
                  <td className="py-2 pr-3 text-right">{s.anyoneLinks}</td>
                  <td className="py-2 pr-3 text-right">{s.orgLinks}</td>
                  <td className="py-2 pr-3 text-right">{s.externalGrants}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <ProgressBar
                        value={s.readiness}
                        tone={s.readiness >= 70 ? 'green' : s.readiness >= 40 ? 'amber' : 'red'}
                      />
                      <span className="w-8 text-right text-xs font-semibold">{s.readiness}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
