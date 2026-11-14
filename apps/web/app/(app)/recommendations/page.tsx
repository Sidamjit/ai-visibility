/**
 * Recommendations: every fix and opportunity, grouped by priority, filtered to
 * the viewer's audience (managers see people/adoption actions only).
 */
import { requireRole } from '@/lib/auth';
import { getFindings, getLatestRun } from '@/lib/data';
import { CATEGORY_LABEL, money } from '@/lib/format';
import { Card, EmptyState, PageHeader, Pill, SeverityBadge } from '@/components/ui';

const GROUPS = [
  { title: 'Do now', severities: ['critical', 'high'] },
  { title: 'Plan next', severities: ['medium'] },
  { title: 'Improve over time', severities: ['low', 'info'] },
];

export default async function RecommendationsPage() {
  const user = await requireRole(['IT', 'EXECUTIVE', 'MANAGER']);
  const run = await getLatestRun(user.tenantId);
  if (!run)
    return (
      <EmptyState title="No analysis yet" body="Run the first analysis to get recommendations." />
    );
  const all = await getFindings(user.tenantId, run.id);
  const visible = all.filter(
    (f) =>
      f.recommendation && (user.role === 'IT' || f.recommendation.audience.includes(user.role)),
  );
  const cur = run.metrics.currency;

  // Collapse per-site findings of the same rule into one recommendation with a site count.
  type Group = { key: string; f: (typeof visible)[number]; count: number; impact: number };
  const byRule = new Map<string, Group>();
  for (const f of visible) {
    const key = `${f.ruleId}:${f.departmentName ?? ''}`;
    const g = byRule.get(key);
    if (g) {
      g.count++;
      g.impact += f.monthlyImpact ?? 0;
    } else byRule.set(key, { key, f, count: 1, impact: f.monthlyImpact ?? 0 });
  }
  const groups = [...byRule.values()];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recommendations"
        subtitle={`${groups.length} actions from ${visible.length} findings, ordered by urgency`}
      />
      {GROUPS.map((g) => {
        const items = groups.filter((x) => g.severities.includes(x.f.severity));
        if (!items.length) return null;
        return (
          <div key={g.title}>
            <h2 className="mb-3 text-lg font-semibold">{g.title}</h2>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {items.map(({ key, f, count, impact }) => (
                <Card key={key}>
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={f.severity} />
                    <Pill>{CATEGORY_LABEL[f.category] ?? f.category}</Pill>
                    <Pill tone={f.kind === 'risk' ? 'red' : 'green'}>{f.kind}</Pill>
                    <Pill tone="blue">effort {f.recommendation!.effort}</Pill>
                    <Pill tone="blue">impact {f.recommendation!.impact}</Pill>
                    {impact > 0 ? (
                      <span className="ml-auto text-sm font-semibold text-emerald-600">
                        {money(impact, cur)}/mo
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-2 font-semibold">{f.recommendation!.title}</h3>
                  <p className="text-sm text-slate-600">
                    {count > 1 ? `${count} locations affected — e.g. ${f.title}` : f.title}
                    {f.departmentName ? ` · ${f.departmentName}` : ''}
                  </p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                    {f.recommendation!.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                  <div className="mt-2 text-xs text-slate-400">
                    {f.ruleId} · for {f.recommendation!.audience.join(', ')}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
