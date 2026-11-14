/**
 * Classification & handling policy: what the organisation's levels allow, how
 * content maps to levels, the YAML editor, and drafts from policy documents.
 */
import { prisma } from '@aiv/db';
import { createLlmClientFromEnv } from '@aiv/content-scan';
import { policyToYaml, type Policy } from '@aiv/policy';
import { getTenantPolicy } from '@aiv/pipeline';
import { requireRole } from '@/lib/auth';
import { classifierCatalogue, classifierNames } from '@/lib/classifiers';
import { dateTime } from '@/lib/format';
import { Card, PageHeader, Pill } from '@/components/ui';
import { PolicyEditor } from '@/components/settings/PolicyEditor';
import { PolicyUpload } from '@/components/settings/PolicyUpload';
import { SubmitButton } from '@/components/SubmitButton';
import { resetPolicyAction, reviewDraftAction } from '../actions';

const yes = (b: boolean) =>
  b ? (
    <span className="text-emerald-700">allowed</span>
  ) : (
    <span className="font-medium text-red-700">no</span>
  );

function llmHost(): string | null {
  try {
    return createLlmClientFromEnv(process.env)?.endpointHost ?? null;
  } catch {
    return null;
  }
}

export default async function PolicyPage() {
  const user = await requireRole(['IT']);
  const [{ policy, source, updatedAt, updatedBy }, drafts] = await Promise.all([
    getTenantPolicy(user.tenantId),
    prisma.policyDraft.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);
  const names = classifierNames(policy);
  const levels = [...policy.levels].sort((a, b) => b.rank - a.rank);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Classification & handling policy"
        subtitle={
          <>
            {source === 'tenant' ? (
              <>
                <b>{policy.name}</b> v{policy.version} · updated {dateTime(updatedAt)} by{' '}
                {updatedBy}
              </>
            ) : (
              <>
                No organisation policy set — the <b>NZ sample policy</b> is applied. Edit it below
                or import your own.
              </>
            )}
          </>
        }
        actions={
          source === 'tenant' ? (
            <form action={resetPolicyAction}>
              <SubmitButton pendingText="Resetting…">Revert to sample</SubmitButton>
            </form>
          ) : undefined
        }
      />

      <Card title="Levels and what each allows">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3">Level</th>
                <th className="py-2 pr-3">Anyone links</th>
                <th className="py-2 pr-3">Org links</th>
                <th className="py-2 pr-3">Guests</th>
                <th className="py-2 pr-3">Public sites</th>
                <th className="py-2 pr-3">Max audience</th>
                <th className="py-2 pr-3">Label</th>
                <th className="py-2 pr-3">Locations</th>
                <th className="py-2 pr-3">Retention</th>
                <th className="py-2 pr-3">Breach severity</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-3">
                    <span
                      className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: l.color ?? '#475569' }}
                    />
                    <b>{l.name}</b>
                    {l.id === policy.defaultLevel ? (
                      <span className="ml-1 text-xs text-slate-500">(default)</span>
                    ) : null}
                    {l.description ? (
                      <div className="max-w-xs text-xs text-slate-500">{l.description}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">{yes(l.sharing.anyoneLinks)}</td>
                  <td className="py-2 pr-3">{yes(l.sharing.organizationLinks)}</td>
                  <td className="py-2 pr-3">{yes(l.sharing.externalGuests)}</td>
                  <td className="py-2 pr-3">{yes(l.sharing.publicSites)}</td>
                  <td className="py-2 pr-3">{l.sharing.maxAudience ?? '—'}</td>
                  <td className="py-2 pr-3 text-xs">
                    {l.labels.required
                      ? l.labels.acceptedLabels.length
                        ? l.labels.acceptedLabels.join(' / ')
                        : l.labels.minimumPriority !== null
                          ? `priority ≥ ${l.labels.minimumPriority}`
                          : 'any sensitive label'
                      : '—'}
                  </td>
                  <td className="py-2 pr-3 text-xs">{describeLocations(l)}</td>
                  <td className="py-2 pr-3 text-xs">
                    {l.retention.maxAgeDays
                      ? `${l.retention.action} after ${l.retention.maxAgeDays} days`
                      : '—'}
                    {l.retention.reference ? (
                      <div className="text-slate-500">{l.retention.reference}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 capitalize">{l.breachSeverity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="How content is classified">
        <ul className="space-y-1.5 text-sm">
          {policy.contentRules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-2">
              <Pill tone="blue">
                {policy.levels.find((l) => l.id === r.level)?.name ?? r.level}
              </Pill>
              <span>
                {r.classifiers.map((c) => names[c] ?? c).join(' or ')}
                {r.minCount > 1 ? `, ≥ ${r.minCount} matches` : ''}
                {r.minDistinct > 1 ? `, ≥ ${r.minDistinct} different values` : ''}
              </span>
              {r.description ? (
                <span className="text-xs text-slate-500">— {r.description}</span>
              ) : null}
            </li>
          ))}
        </ul>
        {policy.classifiers.disabled.length ? (
          <p className="mt-3 text-xs text-slate-500">
            Disabled detectors: {policy.classifiers.disabled.join(', ')}
          </p>
        ) : null}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card title="Edit policy (YAML or JSON)" className="xl:col-span-3">
          <PolicyEditor initial={policyToYaml(policy)} />
          <p className="mt-3 text-xs text-slate-500">
            Saving re-evaluates every scanned file against the new rules immediately — files are not
            re-read. The full schema is documented in docs/POLICY_GUIDE.md.
          </p>
        </Card>
        <div className="space-y-4 xl:col-span-2">
          <Card title="Draft from your policy documents">
            <PolicyUpload llm={llmHost()} />
          </Card>
          <Card title={`Drafts (${drafts.length})`}>
            {drafts.length === 0 ? <p className="text-sm text-slate-500">No drafts yet.</p> : null}
            <div className="space-y-3">
              {drafts.map((d) => {
                const draft = d.draft as unknown as Policy;
                return (
                  <details key={d.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <summary className="cursor-pointer">
                      <b>{d.sourceName}</b>{' '}
                      <Pill
                        tone={
                          d.status === 'pending'
                            ? 'amber'
                            : d.status === 'accepted'
                              ? 'green'
                              : 'slate'
                        }
                      >
                        {d.status}
                      </Pill>{' '}
                      <span className="text-xs text-slate-500">
                        {d.method} · {dateTime(d.createdAt)} · {draft.levels?.length ?? 0} levels,{' '}
                        {draft.contentRules?.length ?? 0} rules
                      </span>
                    </summary>
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
                      {(d.notes as string[]).map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                    <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-950 p-2 text-[11px] text-slate-100">
                      {policyToYaml(draft)}
                    </pre>
                    {d.status === 'pending' ? (
                      <div className="mt-2 flex gap-2">
                        <form action={reviewDraftAction}>
                          <input type="hidden" name="draftId" value={d.id} />
                          <input type="hidden" name="decision" value="accept" />
                          <SubmitButton pendingText="Applying…">Accept &amp; apply</SubmitButton>
                        </form>
                        <form action={reviewDraftAction}>
                          <input type="hidden" name="draftId" value={d.id} />
                          <input type="hidden" name="decision" value="reject" />
                          <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                            Reject
                          </button>
                        </form>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        {d.status} by {d.reviewedBy} {dateTime(d.reviewedAt)}
                      </p>
                    )}
                  </details>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      <Card title="Built-in detectors">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-3">Detector</th>
                <th className="py-2 pr-3">Id</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3">Validation</th>
              </tr>
            </thead>
            <tbody>
              {classifierCatalogue().map((c) => (
                <tr key={c.id} className="border-b border-slate-100 align-top">
                  <td className="py-1.5 pr-3 font-medium">
                    {c.name}
                    {policy.classifiers.disabled.includes(c.id) ? (
                      <span className="ml-2">
                        <Pill>disabled</Pill>
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{c.id}</td>
                  <td className="py-1.5 pr-3 text-slate-600">{c.category}</td>
                  <td className="py-1.5 pr-3 text-xs text-slate-600">{c.validation}</td>
                </tr>
              ))}
              {policy.classifiers.custom.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 align-top">
                  <td className="py-1.5 pr-3 font-medium">
                    {c.name} <Pill tone="blue">custom</Pill>
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{c.id}</td>
                  <td className="py-1.5 pr-3 text-slate-600">{c.category}</td>
                  <td className="py-1.5 pr-3 text-xs text-slate-600">
                    {c.keywords.length ? `keywords: ${c.keywords.slice(0, 6).join(', ')}` : ''}
                    {c.pattern ? ` pattern${c.validator ? ` + ${c.validator}` : ''}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function describeLocations(l: Policy['levels'][number]): string {
  const parts: string[] = [];
  if (l.locations.allowedSitePatterns.length)
    parts.push(`only ${l.locations.allowedSitePatterns.join(', ')}`);
  if (l.locations.blockedSitePatterns.length)
    parts.push(`not ${l.locations.blockedSitePatterns.join(', ')}`);
  if (!l.locations.allowOneDrive) parts.push('no OneDrive');
  if (l.locations.allowedDepartments.length)
    parts.push(`depts: ${l.locations.allowedDepartments.join(', ')}`);
  return parts.join('; ') || 'anywhere';
}
