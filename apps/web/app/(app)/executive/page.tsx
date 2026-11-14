/**
 * ELT / Executive dashboard: risk and value at a glance, spend vs value,
 * trend, top 5 risks and top 5 opportunities. No file names or personal data.
 */
import { requireRole } from '@/lib/auth';
import { getFindings, getLatestRun, getTrend } from '@/lib/data';
import { BREACH_LABEL, date, money, num, pct } from '@/lib/format';
import { SimpleBarChart, TrendChart } from '@/components/charts';
import {
  ButtonLink,
  Card,
  EmptyState,
  Kpi,
  PageHeader,
  ScoreRing,
  SeverityBadge,
} from '@/components/ui';

export default async function ExecutivePage() {
  const user = await requireRole(['IT', 'EXECUTIVE']);
  const run = await getLatestRun(user.tenantId);
  if (!run)
    return (
      <EmptyState
        title="No analysis yet"
        body="Connect a data source and run the first sync to see your AI risk and value."
        href="/connectors"
        cta="Go to connectors"
      />
    );

  const [findings, trend] = await Promise.all([
    getFindings(user.tenantId, run.id),
    getTrend(user.tenantId),
  ]);
  const m = run.metrics;
  const cur = m.currency;
  const risks = findings.filter((f) => f.kind === 'risk').slice(0, 5);
  const opportunities = findings
    .filter((f) => f.kind === 'opportunity' || (f.monthlyImpact ?? 0) > 0)
    .sort((a, b) => (b.monthlyImpact ?? 0) - (a.monthlyImpact ?? 0))
    .slice(0, 5);
  const first = trend[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive overview"
        subtitle={`AI risk, spend and value across the organisation · data as of ${date(run.asOf)}`}
        actions={
          <>
            <ButtonLink href="/report">Board-ready report</ButtonLink>
            <ButtonLink href="/recommendations" variant="primary">
              Recommendations
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Scores" className="lg:col-span-1">
          <div className="flex justify-around">
            <ScoreRing score={run.riskScore} label="Risk (lower is better)" invert />
            <ScoreRing score={run.valueScore} label="Value realised" />
          </div>
          {first ? (
            <p className="mt-4 text-center text-xs text-slate-500">
              Since {date(first.date)}: risk {first.risk} → {run.riskScore}, value {first.value} →{' '}
              {run.valueScore}
            </p>
          ) : null}
        </Card>
        <Card title="Trend" className="lg:col-span-2">
          <TrendChart data={trend} />
          {trend.some((t) => t.simulated) ? (
            <p className="text-xs text-slate-400">
              Earlier points are simulated history for the demo tenant.
            </p>
          ) : null}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="AI spend / month"
          value={money(m.monthlySpend, cur)}
          hint={`${m.licensedSeats} Copilot seats + ${money(m.otherSpend, cur)} other`}
        />
        <Kpi
          label="Est. value / month"
          value={money(m.estimatedMonthlyValue, cur)}
          hint={`${m.estimatedHoursSavedPerMonth.toLocaleString()} hours saved (estimate)`}
          tone="good"
        />
        <Kpi
          label="Value ÷ spend"
          value={m.roi !== null ? `${m.roi.toFixed(1)}x` : '—'}
          tone={m.roi !== null && m.roi >= 1 ? 'good' : 'bad'}
          hint="Using your editable assumptions"
        />
        <Kpi
          label="Active seats"
          value={pct(m.adoptionRate)}
          hint={`${m.activeSeats} of ${m.licensedSeats} used in last ${run.assumptions.inactiveSeatDays} days`}
          tone={m.adoptionRate >= 0.7 ? 'good' : 'warn'}
        />
        <Kpi
          label="Wasted spend / month"
          value={money(m.wastedSpend, cur)}
          hint={`${m.inactiveSeats} inactive seats`}
          tone={m.wastedSpend > 0 ? 'bad' : 'good'}
        />
        <Kpi
          label="Exposed sensitive items"
          value={m.anyoneLinks + m.orgLinks + m.externalGrants}
          hint={`${m.unlabeledSensitive} sensitive items unlabelled`}
          tone="bad"
        />
      </div>

      {run.content ? (
        <Card
          title="Sensitive content vs your classification policy"
          action={
            user.role === 'IT' ? (
              <ButtonLink href="/it/breaches">Breach detail</ButtonLink>
            ) : undefined
          }
        >
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div>
              <div className="text-4xl font-semibold text-red-600">
                {run.content.breachingFiles}
                <span className="ml-1 text-base font-normal text-slate-500">
                  of {run.content.classifiedFiles} classified files
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                are stored or shared in a way your policy ({run.content.policyName}) does not allow.
                {num(run.content.filesScanned)} files were read inside your environment; no content
                was stored.
              </p>
            </div>
            <div className="space-y-1.5 text-sm">
              {[...run.content.levels]
                .filter((l) => l.files > 0)
                .sort((a, b) => b.rank - a.rank)
                .map((l) => (
                  <div key={l.levelId} className="flex items-center justify-between gap-2">
                    <span>
                      <span
                        className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: l.color ?? '#475569' }}
                      />
                      {l.name}
                    </span>
                    <span className="text-slate-600">
                      {l.files} files ·{' '}
                      <strong className={l.breachingFiles ? 'text-red-700' : 'text-emerald-700'}>
                        {l.breachingFiles} breaching
                      </strong>
                    </span>
                  </div>
                ))}
            </div>
            <div className="space-y-1.5 text-sm">
              {Object.entries(run.content.breachesByType)
                .filter(([, n]) => n > 0)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([t, n]) => (
                  <div key={t} className="flex justify-between">
                    <span>{BREACH_LABEL[t] ?? t}</span>
                    <span className="font-semibold">{n} files</span>
                  </div>
                ))}
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Top 5 risks">
          <ol className="space-y-3">
            {risks.map((f) => (
              <li key={f.id} className="flex gap-3">
                <SeverityBadge severity={f.severity} />
                <div>
                  <div className="text-sm font-medium">{f.title}</div>
                  <div className="text-xs text-slate-500">{f.recommendation?.title}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Top 5 opportunities">
          <ol className="space-y-3">
            {opportunities.map((f) => (
              <li key={f.id} className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{f.title}</div>
                  <div className="text-xs text-slate-500">{f.recommendation?.title}</div>
                </div>
                {f.monthlyImpact ? (
                  <span className="whitespace-nowrap text-sm font-semibold text-emerald-600">
                    {money(f.monthlyImpact, cur)}/mo
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="What drives the risk score">
          <SimpleBarChart
            layout="vertical"
            height={220}
            data={Object.entries(run.scores.riskComponents).map(([name, value]) => ({
              name,
              value,
            }))}
            bars={[{ key: 'value', label: 'Component (0-100)', color: '#dc2626' }]}
          />
          <p className="text-xs text-slate-500">
            {'policy' in run.scores.riskComponents
              ? 'Weights: exposure 30%, policy breaches 20%, labelling 15%, site readiness 15%, severity 10%, licence waste 10%.'
              : 'Weights: exposure 40%, labelling 20%, site readiness 20%, severity 10%, licence waste 10%.'}
          </p>
        </Card>
        <Card title="Spend vs estimated value (monthly)">
          <SimpleBarChart
            height={220}
            data={trend.map((t) => ({
              name: new Date(t.date).toLocaleDateString('en-NZ', {
                day: 'numeric',
                month: 'short',
              }),
              spend: t.spend,
              value: t.estValue,
            }))}
            bars={[
              { key: 'spend', label: 'Spend', color: '#94a3b8' },
              { key: 'value', label: 'Est. value', color: '#059669' },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
