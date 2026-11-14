/**
 * Middle-manager dashboard: team adoption vs the organisation, feature usage
 * (capability gaps), suggested training, and who could use a nudge.
 * MANAGER users are locked to their own department; IT/Executive can switch.
 */
import Link from 'next/link';
import { TRAINING_BY_FEATURE } from '@aiv/analysis';
import { requireRole } from '@/lib/auth';
import { getDepartmentPeople, getFindings, getLatestRun } from '@/lib/data';
import { date, num, pct } from '@/lib/format';
import { SimpleBarChart } from '@/components/charts';
import { Card, EmptyState, Kpi, PageHeader, Pill } from '@/components/ui';

const APPS = ['teams', 'outlook', 'word', 'excel', 'powerpoint', 'chat', 'loop', 'onenote'];

export default async function ManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string }>;
}) {
  const user = await requireRole(['IT', 'EXECUTIVE', 'MANAGER']);
  const run = await getLatestRun(user.tenantId);
  if (!run)
    return (
      <EmptyState title="No analysis yet" body="Your IT team hasn't run the first analysis yet." />
    );
  const { dept: requested } = await searchParams;
  const departments = run.departments.filter((d) => d.licensed > 0 || d.headcount > 0);
  const deptName =
    user.role === 'MANAGER'
      ? (user.department ?? departments[0]?.name)
      : (requested ?? departments[0]?.name);
  const dept = run.departments.find((d) => d.name === deptName);
  if (!dept)
    return (
      <EmptyState title="No department data" body="No usage data was found for your department." />
    );

  const [people, deptFindings] = await Promise.all([
    getDepartmentPeople(user.tenantId, dept.name),
    getFindings(user.tenantId, run.id, { departmentName: dept.name }),
  ]);
  // Managers act on people/adoption recommendations; site remediation belongs to IT.
  const findings = deptFindings.filter((f) => f.recommendation?.audience.includes('MANAGER'));
  const orgAdoption = run.metrics.adoptionRate;
  const leastUsed = APPS.map((a) => ({ app: a, users: dept.featureUsers[a] ?? 0 }))
    .sort((x, y) => x.users - y.users)
    .slice(0, 3);
  const inactiveDays = run.assumptions.inactiveSeatDays;
  const isInactive = (d: Date | null) =>
    !d || Date.now() - new Date(d).getTime() > inactiveDays * 86_400_000;
  const nudge = people.filter((p) => p.licensed && isInactive(p.lastActivityAt));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Team adoption — ${dept.name}`}
        subtitle={`How your team is using AI and where to help · data as of ${date(run.asOf)}`}
        actions={
          user.role !== 'MANAGER' ? (
            <form className="flex gap-2">
              <select
                name="dept"
                defaultValue={dept.name}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
              >
                {departments.map((d) => (
                  <option key={d.name}>{d.name}</option>
                ))}
              </select>
              <button className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm">
                View
              </button>
            </form>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Kpi label="People" value={dept.headcount} />
        <Kpi label="Copilot seats" value={dept.licensed} />
        <Kpi
          label="Active seats"
          value={pct(dept.adoptionRate)}
          hint={`Org average ${pct(orgAdoption)}`}
          tone={dept.adoptionRate >= run.assumptions.departmentAdoptionTarget ? 'good' : 'warn'}
        />
        <Kpi
          label="Apps per active user"
          value={num(dept.avgBreadth)}
          hint="of 8 Copilot surfaces"
          tone={dept.avgBreadth > run.assumptions.lowFeatureBreadthThreshold ? 'good' : 'warn'}
        />
        <Kpi
          label="Est. hours saved / month"
          value={dept.estimatedHoursSavedPerMonth}
          tone="good"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Adoption by department (active vs inactive seats)">
          <SimpleBarChart
            height={300}
            data={run.departments
              .filter((d) => d.licensed > 0)
              .map((d) => ({ name: d.name, active: d.active, inactive: d.licensed - d.active }))}
            bars={[
              { key: 'active', label: 'Active', color: '#059669', stack: 's' },
              { key: 'inactive', label: 'Inactive', color: '#fca5a5', stack: 's' },
            ]}
          />
        </Card>
        <Card title="Where your team uses Copilot (licensed users per app)">
          <SimpleBarChart
            height={300}
            data={APPS.map((a) => ({ name: a, users: dept.featureUsers[a] ?? 0 }))}
            bars={[{ key: 'users', label: 'Users', color: '#0284c7' }]}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Suggested training (capability gaps)">
          <ul className="space-y-3">
            {leastUsed.map((l) => (
              <li key={l.app} className="flex items-start gap-3">
                <Pill tone="amber">{l.users} users</Pill>
                <span className="text-sm">{TRAINING_BY_FEATURE[l.app] ?? l.app}</span>
              </li>
            ))}
          </ul>
          {findings.length ? (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">
                Related recommendations
              </div>
              <ul className="space-y-1 text-sm">
                {findings.map((f) => (
                  <li key={f.id}>
                    • {f.recommendation?.title ?? f.title}{' '}
                    <span className="text-slate-400">({f.ruleId})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Link
            href="/recommendations"
            className="mt-3 inline-block text-sm text-sky-700 hover:underline"
          >
            All recommendations →
          </Link>
        </Card>
        <Card
          title={`Could use a nudge (${nudge.length} licensed, inactive ${inactiveDays}+ days)`}
        >
          <div className="max-h-72 overflow-auto">
            <table className="min-w-full text-sm">
              <tbody>
                {nudge.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3">{p.name}</td>
                    <td className="py-1.5 pr-3 text-slate-500">{p.jobTitle}</td>
                    <td className="py-1.5 text-right text-xs text-slate-500">
                      {p.lastActivityAt ? `last used ${date(p.lastActivityAt)}` : 'never used'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {nudge.length === 0 ? (
              <p className="text-sm text-slate-500">Everyone with a seat is active. 🎉</p>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
