import { getServerSession } from 'next-auth';
import { audit } from '@aiv/pipeline';
import { authOptions } from '@/lib/auth';
import { classifierNames } from '@/lib/classifiers';
import { getContentFiles, getLatestRun } from '@/lib/data';
import { accessSummary } from '@/lib/format';

export const dynamic = 'force-dynamic';

const csv = (v: unknown) => {
  // Neutralise spreadsheet formulas in values that come from file/site names.
  const s = String(v ?? '');
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** CSV of classified files and their policy breaches (no file content). IT + Executive. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !['IT', 'EXECUTIVE'].includes(session.user.role))
    return new Response('Forbidden', { status: 403 });
  const { tenantId, email, role } = session.user;
  const run = await getLatestRun(tenantId);
  if (!run) return new Response('No analysis yet', { status: 404 });
  const files = await getContentFiles(tenantId, run.id);
  const names = classifierNames();
  const header = [
    'file',
    'site',
    'department',
    'classification',
    'classifiedBy',
    'detected',
    'label',
    'whoHasAccess',
    'anyoneLinks',
    'orgLinks',
    'externalGuests',
    'audience',
    'lastModified',
    'breachTypes',
    'breaches',
    'url',
  ];
  const lines = files.map((f) =>
    [
      f.name,
      f.siteName,
      f.department,
      f.levelName,
      f.classificationSource,
      f.classifiers.map((c) => `${names[c.classifierId] ?? c.classifierId} ×${c.count}`).join('; '),
      f.label,
      accessSummary(f.exposure),
      f.exposure.anyoneLinks,
      f.exposure.organizationLinks,
      f.exposure.externalPrincipals,
      f.exposure.audienceSize,
      f.lastModifiedAt?.slice(0, 10),
      f.breaches.map((b) => b.type).join('; '),
      f.breaches.map((b) => b.message).join(' | '),
      f.webUrl,
    ]
      .map(csv)
      .join(','),
  );
  const filename = `content-breaches-${run.asOf.toISOString().slice(0, 10)}.csv`;
  await audit({ tenantId, actor: email, actorRole: role, action: 'export.csv', target: filename });
  return new Response([header.join(','), ...lines].join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
    },
  });
}
