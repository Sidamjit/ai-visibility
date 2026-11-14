/**
 * Content & policy breaches: what the content scan found (classifier counts,
 * never content) compared with the organisation's classification policy.
 */
import { requireRole } from '@/lib/auth';
import { classifierNames } from '@/lib/classifiers';
import { getContentFiles, getContentTrend, getFindings, getLatestRun } from '@/lib/data';
import { BREACH_LABEL, accessSummary, bytes, date, dateTime, num } from '@/lib/format';
import { SimpleBarChart } from '@/components/charts';
import { ContentFilesTable } from '@/components/ContentFilesTable';
import { Evidence } from '@/components/Evidence';
import { ButtonLink, Card, EmptyState, Kpi, PageHeader, SeverityBadge } from '@/components/ui';

export default async function BreachesPage() {
  const user = await requireRole(['IT']);
  const run = await getLatestRun(user.tenantId);
  const c = run?.content;
  if (!run || !c)
    return (
      <EmptyState
        title="No content scan yet"
        body="Content scanning reads files inside your environment and compares what they contain with your classification policy. Enable it in Settings → Content scanning, set your policy, then run a sync."
        href="/settings/scanning"
        cta="Content scanning settings"
      />
    );
  const [files, findings, trend] = await Promise.all([
    getContentFiles(user.tenantId, run.id),
    getFindings(user.tenantId, run.id),
    getContentTrend(user.tenantId),
  ]);
  const names = classifierNames();
  const levelColor = new Map(c.levels.map((l) => [l.levelId, l.color]));
  const policyFindings = findings.filter((f) => f.category === 'policy');
  const secrets = c.classifiers.find((x) => x.classifierId === 'secret-credential');
  const breachTypes = Object.entries(c.breachesByType)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Content & policy breaches"
        subtitle={
          <>
            File content compared with <strong>{c.policyName}</strong> (v{c.policyVersion}) · last
            scan {dateTime(c.lastScanAt)} · analysis {date(run.createdAt)}
          </>
        }
        actions={
          <>
            <a
              href="/api/content/export"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Export files CSV
            </a>
            <ButtonLink href="/settings/policy">Edit policy</ButtonLink>
          </>
        }
      />

      <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900">
        Files were read <strong>inside your environment</strong> and discarded after classification.
        This app stores only detector names, counts, keyed hashes
        {c.snippetsStored ? ' and short redacted snippets' : ''} — never file content. The app
        vendor cannot see this page unless you grant time-boxed support access.
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Files scanned"
          value={num(c.filesScanned)}
          hint={`${bytes(c.bytesScanned)} read · ${c.filesSkipped} skipped · ${c.filesFailed} unreadable`}
        />
        <Kpi label="With sensitive content" value={c.filesWithHits} hint="any detector matched" />
        <Kpi label="Classified above default" value={c.classifiedFiles} tone="warn" />
        <Kpi
          label="Breaching policy"
          value={c.breachingFiles}
          tone={c.breachingFiles ? 'bad' : 'good'}
          hint={
            c.classifiedFiles
              ? `${Math.round((c.breachingFiles / c.classifiedFiles) * 100)}% of classified files`
              : undefined
          }
        />
        <Kpi
          label="Files with credentials"
          value={secrets?.files ?? 0}
          tone={secrets?.files ? 'bad' : 'good'}
          hint="passwords, keys, tokens"
        />
        <Kpi
          label="Policy findings"
          value={policyFindings.length}
          hint={`${policyFindings.filter((f) => f.severity === 'critical').length} critical`}
          tone={policyFindings.length ? 'bad' : 'good'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Files by classification">
          <SimpleBarChart
            height={240}
            data={[...c.levels]
              .sort((a, b) => b.rank - a.rank)
              .map((l) => ({
                name: l.name,
                compliant: l.files - l.breachingFiles,
                breaching: l.breachingFiles,
              }))}
            bars={[
              { key: 'breaching', label: 'Breaching', color: '#dc2626' },
              { key: 'compliant', label: 'Compliant', color: '#059669' },
            ]}
          />
        </Card>
        <Card title="Breaches by type">
          <SimpleBarChart
            layout="vertical"
            height={240}
            data={breachTypes.map(([t, n]) => ({ name: BREACH_LABEL[t] ?? t, files: n }))}
            bars={[{ key: 'files', label: 'Files', color: '#f97316' }]}
          />
        </Card>
        <Card title="Breaching files over time">
          <SimpleBarChart
            height={240}
            data={trend.map((t) => ({
              name: new Date(t.date).toLocaleDateString('en-NZ', {
                day: 'numeric',
                month: 'short',
              }),
              breaching: t.breaching,
            }))}
            bars={[{ key: 'breaching', label: 'Breaching files', color: '#dc2626' }]}
          />
        </Card>
      </div>

      <Card title={`Classified files (${files.length})`}>
        <ContentFilesTable
          levels={[...c.levels]
            .sort((a, b) => b.rank - a.rank)
            .map((l) => ({ id: l.levelId, name: l.name }))}
          rows={files.map((f) => ({
            id: f.locationExternalId,
            name: f.name,
            webUrl: f.webUrl,
            siteExternalId: f.siteExternalId,
            siteName: f.siteName,
            levelId: f.levelId,
            levelName: f.levelName,
            levelRank: f.levelRank,
            levelColor: levelColor.get(f.levelId) ?? null,
            source: f.classificationSource,
            classifiers: f.classifiers.map((x) => ({
              name: names[x.classifierId] ?? x.classifierId,
              count: x.count,
              distinctValues: x.distinctValues,
            })),
            label: f.label,
            access: accessSummary(f.exposure),
            lastModifiedAt: f.lastModifiedAt,
            breaches: f.breaches,
            snippets: f.snippets,
          }))}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="What was detected">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3">Detector</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3 text-right">Files</th>
                <th className="py-2 pr-3 text-right">Matches</th>
              </tr>
            </thead>
            <tbody>
              {c.classifiers.map((x) => (
                <tr key={x.classifierId} className="border-b border-slate-100">
                  <td className="py-1.5 pr-3 font-medium">
                    {names[x.classifierId] ?? x.classifierId}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-600">{x.category}</td>
                  <td className="py-1.5 pr-3 text-right">{x.files}</td>
                  <td className="py-1.5 pr-3 text-right">{num(x.matches)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Policy levels">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3">Level</th>
                <th className="py-2 pr-3 text-right">Files</th>
                <th className="py-2 pr-3 text-right">Breaching</th>
              </tr>
            </thead>
            <tbody>
              {[...c.levels]
                .sort((a, b) => b.rank - a.rank)
                .map((l) => (
                  <tr key={l.levelId} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3">
                      <span
                        className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: l.color ?? '#475569' }}
                      />
                      {l.name}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{l.files}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold text-red-700">
                      {l.breachingFiles || '—'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title={`Policy findings & recommended fixes (${policyFindings.length})`}>
        <div className="space-y-3">
          {policyFindings.slice(0, 40).map((f) => (
            <details key={f.id} className="rounded-lg border border-slate-200 p-3">
              <summary className="flex cursor-pointer items-start gap-3">
                <SeverityBadge severity={f.severity} />
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">
                    <span className="mr-2 font-mono text-xs text-slate-500">{f.ruleId}</span>
                    {f.title}
                  </div>
                  <div className="text-sm text-slate-600">{f.summary}</div>
                </div>
              </summary>
              <div className="mt-3 space-y-3 pl-2">
                {f.recommendation ? (
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      Fix: {f.recommendation.title}
                    </div>
                    <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-slate-700">
                      {f.recommendation.steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  </div>
                ) : null}
                <Evidence evidence={f.evidence} maxRows={10} />
              </div>
            </details>
          ))}
          {policyFindings.length > 40 ? (
            <p className="text-xs text-slate-500">
              Showing 40 of {policyFindings.length}. Export CSV for the full list.
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
