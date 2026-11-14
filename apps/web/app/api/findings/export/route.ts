import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getFindings, getLatestRun } from '@/lib/data';

export const dynamic = 'force-dynamic';

const csv = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** CSV export of the latest findings (IT and Executive roles). */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !['IT', 'EXECUTIVE'].includes(session.user.role))
    return new Response('Forbidden', { status: 403 });
  const run = await getLatestRun(session.user.tenantId);
  if (!run) return new Response('No analysis yet', { status: 404 });
  const findings = await getFindings(session.user.tenantId, run.id);
  const header = [
    'severity',
    'ruleId',
    'category',
    'kind',
    'title',
    'summary',
    'department',
    'affected',
    'monthlyImpact',
    'recommendation',
    'steps',
  ];
  const lines = findings.map((f) =>
    [
      f.severity,
      f.ruleId,
      f.category,
      f.kind,
      f.title,
      f.summary,
      f.departmentName,
      f.affectedCount,
      f.monthlyImpact,
      f.recommendation?.title,
      f.recommendation?.steps.join(' | '),
    ]
      .map(csv)
      .join(','),
  );
  return new Response([header.join(','), ...lines].join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="findings-${run.asOf.toISOString().slice(0, 10)}.csv"`,
    },
  });
}
