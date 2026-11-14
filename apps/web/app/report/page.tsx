/**
 * Exportable full-analysis report. Printable HTML: use the browser's
 * "Save as PDF" (A4 print styles in globals.css). Rendered outside the app
 * shell so the PDF has no navigation chrome.
 */
import Link from 'next/link';
import { ASSUMPTION_DOCS, BRAND, type Assumptions } from '@aiv/core';
import { RULES } from '@aiv/analysis';
import { requireRole } from '@/lib/auth';
import { getFindings, getLatestRun, getTenant, getTrend } from '@/lib/data';
import { BREACH_LABEL, CATEGORY_LABEL, date, money, num, pct } from '@/lib/format';
import { classifierNames } from '@/lib/classifiers';
import { PrintButton } from '@/components/PrintButton';
import { SeverityBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 mt-8 border-b border-slate-300 pb-1 text-xl font-semibold">{children}</h2>
  );
}

export default async function ReportPage() {
  const user = await requireRole(['IT', 'EXECUTIVE']);
  const [tenant, run] = await Promise.all([getTenant(user.tenantId), getLatestRun(user.tenantId)]);
  if (!run) return <p className="p-8">No analysis yet.</p>;
  const [findings, trend] = await Promise.all([
    getFindings(user.tenantId, run.id),
    getTrend(user.tenantId),
  ]);
  const m = run.metrics;
  const cur = m.currency;
  const risks = findings.filter((f) => f.kind === 'risk');
  const opps = findings.filter((f) => f.kind === 'opportunity');
  const counts = findings.reduce<Record<string, number>>(
    (a, f) => ({ ...a, [f.severity]: (a[f.severity] ?? 0) + 1 }),
    {},
  );
  const first = trend[0];
  const c = run.content;
  const names = classifierNames();

  return (
    <main className="mx-auto max-w-4xl bg-white p-10 text-slate-900 print:p-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href="/" className="text-sm text-sky-700 hover:underline">
          ← Back to dashboards
        </Link>
        <PrintButton />
      </div>

      <header className="border-b-4 border-slate-900 pb-6">
        <div className="text-xs font-semibold uppercase tracking-widest text-sky-700">
          {BRAND.vendorName}
        </div>
        <h1 className="mt-2 text-3xl font-bold">AI Risk & Value Assessment</h1>
        <p className="mt-1 text-lg text-slate-600">{tenant.name}</p>
        <p className="mt-2 text-sm text-slate-500">
          Prepared with {BRAND.productName} · data as of {date(run.asOf)} · generated{' '}
          {date(new Date())}
        </p>
      </header>

      <H2>1. Executive summary</H2>
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="rounded-lg border p-4">
          <div className="text-4xl font-bold text-red-600">{run.riskScore}</div>
          <div className="text-sm text-slate-500">Risk score (0-100, lower is better)</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-4xl font-bold text-emerald-600">{run.valueScore}</div>
          <div className="text-sm text-slate-500">Value score (0-100)</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-4xl font-bold">{m.roi !== null ? `${m.roi.toFixed(1)}x` : '—'}</div>
          <div className="text-sm text-slate-500">Estimated value ÷ spend</div>
        </div>
      </div>
      <ul className="mt-4 list-disc space-y-1 pl-6 text-sm">
        <li>
          {m.sites} SharePoint/Teams sites analysed: <b>{m.anyoneLinks}</b> anyone links,{' '}
          <b>{m.orgLinks}</b> organisation-wide links and <b>{m.externalGrants}</b> guest grants;{' '}
          <b>{m.unlabeledSensitive}</b> of {m.sensitiveLocations} sensitive locations have no
          sensitivity label.
        </li>
        <li>
          {m.licensedSeats} Microsoft 365 Copilot seats, <b>{pct(m.adoptionRate)}</b> active.{' '}
          {m.inactiveSeats} inactive seats cost <b>{money(m.wastedSpend, cur)}</b> per month.
        </li>
        <li>
          AI spend {money(m.monthlySpend, cur)}/month against an estimated{' '}
          {money(m.estimatedMonthlyValue, cur)}/month of time saved (
          {m.estimatedHoursSavedPerMonth.toLocaleString()} hours, conservative assumptions in
          Appendix A).
        </li>
        {c ? (
          <li>
            {num(c.filesScanned)} files were read inside your environment and compared with{' '}
            <i>{c.policyName}</i>: <b>{c.classifiedFiles}</b> contain information classified above
            the default level and <b>{c.breachingFiles}</b> of them are stored, labelled or shared
            in breach of the policy.
          </li>
        ) : null}
        <li>
          {findings.length} findings:{' '}
          {['critical', 'high', 'medium', 'low', 'info']
            .map((s) => `${counts[s] ?? 0} ${s}`)
            .join(', ')}
          .
        </li>
        {first && first.date !== run.createdAt.toISOString() ? (
          <li>
            Since {date(first.date)}, risk moved {first.risk} → {run.riskScore} and value{' '}
            {first.value} → {run.valueScore}.
          </li>
        ) : null}
      </ul>

      <H2>2. Top risks</H2>
      <ol className="space-y-2 text-sm">
        {risks.slice(0, 10).map((f) => (
          <li key={f.id} className="flex gap-2">
            <SeverityBadge severity={f.severity} />
            <span>
              <b>{f.title}</b> — {f.recommendation?.title}
            </span>
          </li>
        ))}
      </ol>

      <H2>3. Opportunities</H2>
      <ol className="space-y-2 text-sm">
        {opps.map((f) => (
          <li key={f.id}>
            <b>{f.title}</b>
            {f.monthlyImpact ? (
              <span className="text-emerald-700"> ({money(f.monthlyImpact, cur)}/month)</span>
            ) : null}{' '}
            — {f.recommendation?.title}
          </li>
        ))}
      </ol>

      {c ? (
        <section className="break-before">
          <H2>4. Sensitive content vs classification policy</H2>
          <p className="text-sm text-slate-700">
            Policy: <b>{c.policyName}</b> (v{c.policyVersion}). {num(c.filesScanned)} files scanned,{' '}
            {c.filesSkipped} skipped (size/type limits), {c.filesFailed} unreadable (e.g.
            encrypted). Classification is derived from what the files contain (validated detectors
            such as IRD-number checksums and Luhn-valid card numbers), not from their names.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-6">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1">Classification</th>
                  <th className="text-right">Files</th>
                  <th className="text-right">Breaching</th>
                </tr>
              </thead>
              <tbody>
                {[...c.levels]
                  .sort((a, b) => b.rank - a.rank)
                  .map((l) => (
                    <tr key={l.levelId} className="border-b border-slate-100">
                      <td className="py-1">{l.name}</td>
                      <td className="text-right">{l.files}</td>
                      <td className="text-right font-semibold">{l.breachingFiles}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1">Breach</th>
                  <th className="text-right">Files</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(c.breachesByType)
                  .filter(([, n]) => n > 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([t, n]) => (
                    <tr key={t} className="border-b border-slate-100">
                      <td className="py-1">{BREACH_LABEL[t] ?? t}</td>
                      <td className="text-right">{n}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-600">
            Detected:{' '}
            {c.classifiers
              .map((x) => `${names[x.classifierId] ?? x.classifierId} (${x.files} files)`)
              .join(', ')}
            . File-level detail (location, who has access, detectors, breaches) is in the ICT view
            and the content-breaches CSV export.
          </p>
        </section>
      ) : null}

      <section className="break-before">
        <H2>{c ? 5 : 4}. Copilot readiness by site</H2>
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Site</th>
              <th>Dept</th>
              <th>Visibility</th>
              <th className="text-right">Sensitive</th>
              <th className="text-right">Anyone</th>
              <th className="text-right">Org</th>
              <th className="text-right">Guests</th>
              <th className="text-right">Readiness</th>
            </tr>
          </thead>
          <tbody>
            {run.siteScores.map((s) => (
              <tr key={s.siteExternalId} className="border-b border-slate-100">
                <td className="py-1">{s.name}</td>
                <td>{s.department}</td>
                <td>{s.visibility}</td>
                <td className="text-right">{s.sensitiveItems}</td>
                <td className="text-right">{s.anyoneLinks}</td>
                <td className="text-right">{s.orgLinks}</td>
                <td className="text-right">{s.externalGrants}</td>
                <td className="text-right font-semibold">{s.readiness}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <H2>{c ? 6 : 5}. Adoption by department</H2>
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1">Department</th>
              <th className="text-right">People</th>
              <th className="text-right">Seats</th>
              <th className="text-right">Active</th>
              <th className="text-right">Adoption</th>
              <th className="text-right">Apps/user</th>
              <th className="text-right">Hours saved/mo</th>
            </tr>
          </thead>
          <tbody>
            {run.departments.map((d) => (
              <tr key={d.name} className="border-b border-slate-100">
                <td className="py-1">{d.name}</td>
                <td className="text-right">{d.headcount}</td>
                <td className="text-right">{d.licensed}</td>
                <td className="text-right">{d.active}</td>
                <td className="text-right">{pct(d.adoptionRate)}</td>
                <td className="text-right">{d.avgBreadth.toFixed(1)}</td>
                <td className="text-right">{d.estimatedHoursSavedPerMonth}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="break-before">
        <H2>{c ? 7 : 6}. All findings and recommended fixes</H2>
        <div className="space-y-4">
          {findings.map((f) => (
            <div
              key={f.id}
              className="border-b border-slate-100 pb-3 text-sm"
              style={{ breakInside: 'avoid' }}
            >
              <div className="flex items-center gap-2">
                <SeverityBadge severity={f.severity} />
                <span className="font-mono text-xs text-slate-500">{f.ruleId}</span>
                <span className="text-xs text-slate-500">
                  {CATEGORY_LABEL[f.category] ?? f.category}
                </span>
              </div>
              <div className="mt-1 font-semibold">{f.title}</div>
              <div className="text-slate-600">{f.summary}</div>
              {f.recommendation ? (
                <ol className="mt-1 list-decimal pl-6 text-slate-700">
                  {f.recommendation.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="break-before">
        <H2>Appendix A. Value assumptions</H2>
        <table className="min-w-full text-xs">
          <tbody>
            {(Object.keys(ASSUMPTION_DOCS) as Array<keyof Assumptions>).map((k) => (
              <tr key={k} className="border-b border-slate-100 align-top">
                <td className="py-1 pr-3 font-medium">{ASSUMPTION_DOCS[k].label}</td>
                <td className="py-1 pr-3 font-mono">{String(run.assumptions[k])}</td>
                <td className="py-1 text-slate-600">{ASSUMPTION_DOCS[k].help}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <H2>Appendix B. Method and data handling</H2>
        <p className="text-sm text-slate-700">
          Data is collected read-only through Microsoft Graph with application permissions approved
          by your administrator, and the application runs inside your own environment. Metadata
          (names, dates, sharing settings, labels, usage dates) is stored for analysis.{' '}
          {c
            ? 'File content was downloaded into memory, classified with validated detectors and discarded; only detector names, counts, keyed hashes and (if enabled) short redacted snippets are stored — never the content itself. '
            : 'File content scanning was not enabled for this run, so sensitive content is identified from labels and name patterns (e.g. "payroll", "passport") and should be treated as triage. '}
          Mailboxes, chats and Copilot prompts/responses are never read. Value figures are estimates
          based on the assumptions above.
        </p>
        <H2>Appendix C. Rules applied</H2>
        <table className="min-w-full text-xs">
          <tbody>
            {RULES.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 align-top">
                <td className="py-1 pr-3 font-mono">{r.id}</td>
                <td className="py-1 pr-3 font-medium">{r.name}</td>
                <td className="py-1 text-slate-600">{r.rationale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
