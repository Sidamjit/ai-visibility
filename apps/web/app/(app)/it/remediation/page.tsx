/**
 * Remediation checklist: every risk finding's fix steps as tickable tasks.
 * Progress is stored per findingKey + step, so it survives re-analysis.
 */
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { getFindings, getLatestRun, getRemediationState } from '@/lib/data';
import { Card, EmptyState, PageHeader, ProgressBar, SeverityBadge } from '@/components/ui';
import { toggleRemediationStep } from '../../actions';

export default async function RemediationPage() {
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
  const [findings, done] = await Promise.all([
    getFindings(user.tenantId, run.id),
    getRemediationState(user.tenantId),
  ]);
  const tasks = findings.filter(
    (f) => f.kind === 'risk' && f.recommendation && f.recommendation.audience.includes('IT'),
  );
  const total = tasks.reduce((s, f) => s + (f.recommendation?.steps.length ?? 0), 0);
  const completed = tasks.reduce(
    (s, f) =>
      s + (f.recommendation?.steps.filter((_, i) => done.has(`${f.findingKey}#${i}`)).length ?? 0),
    0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Remediation checklist"
        subtitle="Work through fixes in severity order. Ticks are saved and carried across analysis runs."
      />
      <Card>
        <div className="flex items-center gap-4">
          <div className="w-full">
            <ProgressBar value={total ? (completed / total) * 100 : 0} tone="green" />
          </div>
          <div className="whitespace-nowrap text-sm font-medium">
            {completed} / {total} steps
          </div>
        </div>
      </Card>
      {tasks.map((f) => (
        <Card key={f.id}>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <SeverityBadge severity={f.severity} />
            <span className="font-mono text-xs text-slate-500">{f.ruleId}</span>
            {f.siteExternalId ? (
              <Link
                href={`/it/sites/${encodeURIComponent(f.siteExternalId)}`}
                className="font-medium hover:underline"
              >
                {f.title}
              </Link>
            ) : (
              <span className="font-medium">{f.title}</span>
            )}
          </div>
          <div className="mb-2 text-sm text-slate-600">{f.recommendation?.title}</div>
          <ul className="space-y-1">
            {f.recommendation?.steps.map((step, i) => {
              const isDone = done.has(`${f.findingKey}#${i}`);
              return (
                <li key={i}>
                  <form action={toggleRemediationStep} className="flex items-start gap-2">
                    <input type="hidden" name="findingKey" value={f.findingKey} />
                    <input type="hidden" name="stepIndex" value={i} />
                    <input type="hidden" name="done" value={String(!isDone)} />
                    <button
                      type="submit"
                      aria-label={isDone ? 'Mark not done' : 'Mark done'}
                      className={`mt-0.5 h-4 w-4 shrink-0 rounded border ${isDone ? 'border-emerald-600 bg-emerald-600' : 'border-slate-400 bg-white'}`}
                    />
                    <span className={`text-sm ${isDone ? 'text-slate-400 line-through' : ''}`}>
                      {step}
                    </span>
                  </form>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
