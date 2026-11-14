/**
 * Shared machinery for the policy-breach rules (POL-001..005). Each rule looks
 * at one group of breaches (sharing, audience, label, location, retention)
 * for content-classified files, and reports one finding per site.
 */
import type { BreachGroup, PolicyBreach } from '@aiv/policy';
import type { ClassifiedFile } from '../content';
import type { FindingDraft, Recommendation, RuleContext, RuleDefinition, Severity } from '../types';
import { SEVERITIES } from '../types';

/** Move a severity down by `steps` (critical -> high -> medium -> low; never below low). */
export function shiftSeverity(sev: Severity, steps: number): Severity {
  const i = SEVERITIES.indexOf(sev);
  return SEVERITIES[Math.min(SEVERITIES.indexOf('low'), i + steps)] ?? sev;
}

export const maxSeverity = (list: Severity[]): Severity =>
  list.reduce<Severity>(
    (best, s) => (SEVERITIES.indexOf(s) < SEVERITIES.indexOf(best) ? s : best),
    'info',
  );

/** Evidence row for one file: where it is, what it contains (counts), who can reach it, what breaches. */
export function fileEvidence(f: ClassifiedFile, breaches: PolicyBreach[] = f.breaches) {
  return {
    file: f.location.name,
    location: f.location.webUrl ?? `${f.site?.name ?? ''}`,
    site: f.site?.name ?? null,
    classification: `${f.classification.level.name}${f.classification.source === 'llm' ? ' (LLM-assisted)' : ''}`,
    detected: f.scan.hits
      .map(
        (h) =>
          `${h.classifierId} ×${h.count}${h.distinctValues !== h.count ? ` (${h.distinctValues} distinct)` : ''}`,
      )
      .join(', '),
    whoHasAccess: [
      f.facts.audienceSize !== null ? `~${f.facts.audienceSize} people` : null,
      f.facts.publicSite ? 'public site' : null,
      f.facts.anyoneLinks ? `${f.facts.anyoneLinks} anyone link(s)` : null,
      f.facts.organizationLinks ? `${f.facts.organizationLinks} org-wide link(s)` : null,
      f.facts.externalPrincipals ? `${f.facts.externalPrincipals} external/guest` : null,
      f.grantees.length ? `named: ${f.grantees.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('; '),
    label: f.labelName ?? 'none',
    breaches: breaches.map((b) => b.message),
    ...(f.scan.hits.some((h) => h.snippets.length)
      ? { redactedSnippets: f.scan.hits.flatMap((h) => h.snippets).slice(0, 2) }
      : {}),
  };
}

export interface PolicyRuleSpec {
  id: string;
  name: string;
  group: BreachGroup;
  description: string;
  rationale: string;
  /** Severity steps below the level's breachSeverity (label/retention are less urgent than exposure). */
  severityShift: number;
  title(count: number, siteName: string): string;
  recommendation(files: ClassifiedFile[], ctx: RuleContext): Recommendation;
}

export function policyRule(spec: PolicyRuleSpec): RuleDefinition {
  return {
    id: spec.id,
    name: spec.name,
    category: 'policy',
    kind: 'risk',
    description: spec.description,
    rationale: spec.rationale,
    evaluate(ctx) {
      const content = ctx.index.content;
      if (!content) return [];
      const bySite = new Map<string, Array<{ f: ClassifiedFile; breaches: PolicyBreach[] }>>();
      for (const f of content.files) {
        const breaches = f.breaches.filter((b) => b.group === spec.group);
        if (!breaches.length) continue;
        const key = f.site?.externalId ?? f.location.siteExternalId ?? 'unknown';
        const list = bySite.get(key) ?? [];
        list.push({ f, breaches });
        bySite.set(key, list);
      }
      const out: FindingDraft[] = [];
      for (const [siteId, rows] of bySite) {
        const site = rows[0]!.f.site;
        const siteName = site?.name ?? siteId;
        const severity = maxSeverity(
          rows.map((r) =>
            shiftSeverity(r.f.classification.level.breachSeverity, spec.severityShift),
          ),
        );
        const levels = [...new Set(rows.map((r) => r.f.classification.level.name))];
        const types = [...new Set(rows.flatMap((r) => r.breaches.map((b) => b.type)))];
        out.push({
          ruleId: spec.id,
          key: siteId,
          kind: 'risk',
          category: 'policy',
          severity,
          title: spec.title(rows.length, siteName),
          summary: `${levels.join(' / ')} content — ${types.join(', ')}. Policy: ${content.policy.name}.`,
          evidence: {
            policy: `${content.policy.name} (v${content.policy.version})`,
            files: rows.map((r) => fileEvidence(r.f, r.breaches)),
            detection: 'content scan (in-memory, client-hosted); values never stored',
          },
          siteExternalId: site?.externalId ?? null,
          departmentName: site?.ownerDepartment ?? null,
          affectedCount: rows.length,
          monthlyImpact: null,
          recommendation: spec.recommendation(
            rows.map((r) => r.f),
            ctx,
          ),
        });
      }
      return out;
    },
  };
}

/** "SENSITIVE: Payroll.csv, Scan 0042.pdf (+3 more)" */
export function listFiles(files: ClassifiedFile[], max = 3): string {
  const names = files.slice(0, max).map((f) => `"${f.location.name}"`);
  return `${names.join(', ')}${files.length > max ? ` (+${files.length - max} more)` : ''}`;
}
