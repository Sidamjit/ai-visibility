/**
 * Per-site drill-down: readiness breakdown, findings with evidence and fixes,
 * and the metadata inventory (locations + non-inherited grants).
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getFindings, getLatestRun, getSiteDetail } from '@/lib/data';
import { date } from '@/lib/format';
import { Evidence } from '@/components/Evidence';
import { Card, EmptyState, Kpi, PageHeader, Pill, ScoreRing, SeverityBadge } from '@/components/ui';

export default async function SitePage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId: raw } = await params;
  const siteId = decodeURIComponent(raw);
  const user = await requireRole(['IT']);
  const run = await getLatestRun(user.tenantId);
  if (!run)
    return (
      <EmptyState
        title="No analysis yet"
        body="Run a sync first."
        href="/connectors"
        cta="Connectors"
      />
    );
  const score = run.siteScores.find((s) => s.siteExternalId === siteId);
  if (!score) notFound();
  const [findings, detail] = await Promise.all([
    getFindings(user.tenantId, run.id, { siteExternalId: siteId }),
    getSiteDetail(user.tenantId, siteId),
  ]);
  const grantsByLoc = new Map<string, typeof detail.grants>();
  for (const g of detail.grants)
    grantsByLoc.set(g.locationExternalId, [...(grantsByLoc.get(g.locationExternalId) ?? []), g]);

  return (
    <div className="space-y-6">
      <Link href="/it" className="text-sm text-sky-700 hover:underline">
        ← ICT dashboard
      </Link>
      <PageHeader
        title={score.name}
        subtitle={
          <>
            {score.department ?? 'No owning department'} · {score.visibility} ·{' '}
            {score.memberCount ?? '?'} members
            {score.webUrl ? (
              <>
                {' · '}
                <a
                  className="text-sky-700 hover:underline"
                  href={score.webUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  open in SharePoint
                </a>
              </>
            ) : null}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card title="Copilot readiness">
          <div className="flex justify-center">
            <ScoreRing score={score.readiness} label="Readiness" />
          </div>
        </Card>
        <Card title="Why this score" className="lg:col-span-3">
          {score.deductions.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {score.deductions.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No deductions — this site is in good shape.</p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Sensitive items" value={score.sensitiveItems} />
            <Kpi
              label="Anyone links"
              value={score.anyoneLinks}
              tone={score.anyoneLinks ? 'bad' : 'good'}
            />
            <Kpi label="Org-wide links" value={score.orgLinks} />
            <Kpi label="Guest grants" value={score.externalGrants} />
          </div>
        </Card>
      </div>

      <Card title={`Findings (${findings.length})`}>
        <div className="space-y-5">
          {findings.map((f) => (
            <details
              key={f.id}
              className="rounded-lg border border-slate-200 p-4"
              open={f.severity === 'critical'}
            >
              <summary className="flex cursor-pointer items-center gap-3">
                <SeverityBadge severity={f.severity} />
                <span className="font-mono text-xs text-slate-500">{f.ruleId}</span>
                <span className="font-medium">{f.title}</span>
              </summary>
              <p className="mt-2 text-sm text-slate-600">{f.summary}</p>
              <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                    Evidence
                  </div>
                  <Evidence evidence={f.evidence} />
                </div>
                {f.recommendation ? (
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                      Fix: {f.recommendation.title}
                    </div>
                    <ol className="list-decimal space-y-1 pl-5 text-sm">
                      {f.recommendation.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
            </details>
          ))}
          {findings.length === 0 ? (
            <p className="text-sm text-slate-500">No findings for this site.</p>
          ) : null}
        </div>
      </Card>

      <Card title="Content inventory (metadata only — shared or sensitive items)">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Kind</th>
              <th className="py-2 pr-3">Label</th>
              <th className="py-2 pr-3">Signals</th>
              <th className="py-2 pr-3">Sharing</th>
              <th className="py-2 pr-3">Modified</th>
            </tr>
          </thead>
          <tbody>
            {detail.locations.map((l) => (
              <tr key={l.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-3 font-medium">{l.name}</td>
                <td className="py-2 pr-3 text-slate-600">{l.kind}</td>
                <td className="py-2 pr-3">
                  {l.sensitivityLabelId ? (
                    <Pill tone="blue">
                      {detail.labels.get(l.sensitivityLabelId)?.name ?? 'label'}
                    </Pill>
                  ) : (
                    <span className="text-slate-400">none</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-xs text-slate-600">
                  {(l.sensitivityReasons as string[]).join(', ')}
                  {l.hasUniquePermissions ? (
                    <span className="ml-1">
                      <Pill tone="amber">unique perms</Pill>
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap gap-1">
                    {(grantsByLoc.get(l.externalId) ?? []).map((g) => (
                      <Pill
                        key={g.id}
                        tone={
                          g.scope === 'anyone'
                            ? 'red'
                            : g.scope === 'organization' || g.scope === 'external-guest'
                              ? 'amber'
                              : 'slate'
                        }
                      >
                        {g.scope}
                        {g.externalPrincipalCount > 1 ? ` ×${g.externalPrincipalCount}` : ''}
                      </Pill>
                    ))}
                  </div>
                </td>
                <td className="py-2 pr-3 text-xs text-slate-600">{date(l.lastModifiedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
