import { getServerSession } from 'next-auth';
import { audit } from '@aiv/pipeline';
import { authOptions } from '@/lib/auth';
import { getFindings, getLatestRun } from '@/lib/data';

export const dynamic = 'force-dynamic';

const csv = (v: unknown) => {
  // Neutralise spreadsheet formulas in values derived from site/file names.
  const s = String(v ?? '');
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** Flatten policy-finding evidence (files, who has access, detectors, breaches) for the CSV. */
function evidenceText(e: Record<string, unknown>): string {
  const files = Array.isArray(e.files) ? (e.files as Array<Record<string, unknown>>) : [];
  if (!files.length) return '';
  return files
    .slice(0, 25)
    .map((f) =>
      [f.file ?? f.name, f.classification, f.detected, f.whoHasAccess, f.label]
        .filter(Boolean)
        .join(' / '),
    )
    .join(' | ');
}

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
    'evidence',
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
      evidenceText(f.evidence),
    ]
      .map(csv)
      .join(','),
  );
  await audit({
    tenantId: session.user.tenantId,
    actor: session.user.email,
    actorRole: session.user.role,
    action: 'export.csv',
    target: 'findings.csv',
  });
  return new Response([header.join(','), ...lines].join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="findings-${run.asOf.toISOString().slice(0, 10)}.csv"`,
    },
  });
}
