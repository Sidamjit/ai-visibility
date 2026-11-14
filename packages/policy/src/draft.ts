/**
 * Draft a policy from the client's own policy documents.
 *
 * Two strategies, both producing a DRAFT that a human must review and accept
 * (Settings → Policy → Drafts). Nothing is applied automatically.
 *
 *  1. `draftPolicyHeuristically` — no AI. Finds classification markings,
 *     retention periods and handling phrases with patterns, and fills the rest
 *     from the NZ sample. Always available.
 *  2. `buildPolicyDraftPrompt` + `parseLlmPolicyDraft` — used by the pipeline
 *     ONLY when the client has configured their own LLM endpoint (Azure OpenAI
 *     in their subscription or a local model). See docs/VENDOR_ACCESS.md and
 *     docs/SECURITY.md for why we never call a vendor-hosted model.
 */
import { NZ_PSR_SAMPLE_POLICY } from './sample-nz';
import { PolicySchema, type PolicyInput } from './schema';

export interface PolicyDraftResult {
  draft: PolicyInput;
  /** What was detected and what was assumed — shown to the reviewer. */
  notes: string[];
  method: 'heuristic' | 'llm';
}

/** Known marking vocabularies, least to most sensitive. Synonyms map to one id. */
const MARKINGS: Array<{
  id: string;
  name: string;
  rank: number;
  pattern: RegExp;
  template: string;
}> = [
  {
    id: 'UNCLASSIFIED',
    name: 'Unclassified',
    rank: 0,
    pattern: /\b(UNCLASSIFIED|PUBLIC)\b/g,
    template: 'UNCLASSIFIED',
  },
  {
    id: 'INTERNAL',
    name: 'Internal',
    rank: 5,
    pattern: /\b(INTERNAL(?: USE)?(?: ONLY)?|GENERAL)\b/g,
    template: 'UNCLASSIFIED',
  },
  {
    id: 'IN-CONFIDENCE',
    name: 'In-Confidence',
    rank: 10,
    pattern: /\bIN[- ]CONFIDENCE\b/gi,
    template: 'IN-CONFIDENCE',
  },
  {
    id: 'CONFIDENTIAL',
    name: 'Confidential',
    rank: 15,
    pattern: /\b(?<!HIGHLY )CONFIDENTIAL\b/g,
    template: 'IN-CONFIDENCE',
  },
  {
    id: 'SENSITIVE',
    name: 'Sensitive',
    rank: 20,
    pattern: /\bSENSITIVE\b/g,
    template: 'SENSITIVE',
  },
  {
    id: 'HIGHLY-CONFIDENTIAL',
    name: 'Highly Confidential',
    rank: 25,
    pattern: /\bHIGHLY CONFIDENTIAL\b/gi,
    template: 'SENSITIVE',
  },
  {
    id: 'RESTRICTED',
    name: 'Restricted',
    rank: 30,
    pattern: /\bRESTRICTED\b/g,
    template: 'RESTRICTED',
  },
  {
    id: 'SECRET',
    name: 'Secret',
    rank: 40,
    pattern: /\b(?<!TOP )SECRET\b/g,
    template: 'RESTRICTED',
  },
  {
    id: 'TOP-SECRET',
    name: 'Top Secret',
    rank: 50,
    pattern: /\bTOP SECRET\b/g,
    template: 'RESTRICTED',
  },
];

const RETENTION_RE =
  /\b(?:retain(?:ed)?|retention|kept|keep|dispos(?:e|al)|destroy(?:ed)?)\b[^.\n]{0,80}?\b(\d{1,2})\s*(years?|months?)\b/gi;

/** Pattern-based draft. Marking words must appear at least twice to count (reduces noise). */
export function draftPolicyHeuristically(text: string, sourceName: string): PolicyDraftResult {
  const notes: string[] = [];
  const sample = PolicySchema.parse(NZ_PSR_SAMPLE_POLICY);
  const found = MARKINGS.map((m) => ({ m, count: (text.match(m.pattern) ?? []).length })).filter(
    (x) => x.count >= 2,
  );

  const retentionYears = [...text.matchAll(RETENTION_RE)].map((r) =>
    /month/i.test(r[2] ?? '') ? Number(r[1]) / 12 : Number(r[1]),
  );
  const commonRetention = mode(retentionYears.filter((y) => y > 0 && y <= 99));
  if (commonRetention !== null)
    notes.push(
      `Retention period mentioned most often: ${commonRetention} year(s) — applied to classified levels.`,
    );
  else notes.push('No retention period found — sample defaults (7 years) kept.');

  let levels = sample.levels;
  if (found.length >= 2) {
    notes.push(
      `Classification markings found: ${found.map((f) => `${f.m.name} (${f.count}×)`).join(', ')}.`,
    );
    levels = found.map(({ m }) => {
      const tpl = sample.levels.find((l) => l.id === m.template)!;
      return { ...tpl, id: m.id, name: m.name, rank: m.rank };
    });
    if (!levels.some((l) => l.rank === 0)) {
      const base = sample.levels.find((l) => l.id === 'UNCLASSIFIED')!;
      levels.unshift(base);
      notes.push('Added an UNCLASSIFIED base level (not found in the document).');
    }
  } else {
    notes.push('Fewer than two classification markings found — sample NZ PSR levels used.');
  }
  if (commonRetention !== null) {
    levels = levels.map((l) =>
      l.rank > 0
        ? { ...l, retention: { ...l.retention, maxAgeDays: Math.round(commonRetention * 365) } }
        : l,
    );
  }
  if (/\bnot\b[^.\n]{0,40}\b(shared|disclosed)\b[^.\n]{0,40}\b(external|outside|third)/i.test(text))
    notes.push(
      'Document restricts external sharing — guest access disabled for classified levels (as in sample).',
    );

  // Re-point sample content rules to the closest detected level by rank.
  const byRank = [...levels].sort((a, b) => a.rank - b.rank);
  const closest = (templateId: string) => {
    const want = sample.levels.find((l) => l.id === templateId)!.rank;
    return [...byRank].reverse().find((l) => l.rank <= want)?.id ?? byRank[0]!.id;
  };
  const contentRules = sample.contentRules.map((r) => ({ ...r, level: closest(r.level) }));
  notes.push(
    'Content rules copied from the NZ sample and mapped to the nearest level — review each one.',
  );

  const draft: PolicyInput = {
    ...sample,
    name: `Draft from ${sourceName}`,
    version: 'draft',
    sources: [sourceName],
    levels,
    defaultLevel: byRank[0]!.id,
    contentRules,
  };
  return { draft, notes, method: 'heuristic' };
}

function mode(values: number[]): number | null {
  if (!values.length) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];
}

/**
 * Prompt for a client-hosted LLM. The document text is sent ONLY to the
 * endpoint the client configured; output must be JSON matching the schema.
 */
export function buildPolicyDraftPrompt(
  documentText: string,
  maxChars = 60_000,
): {
  system: string;
  user: string;
} {
  return {
    system:
      "You convert an organisation's information-management / data-classification policy into JSON. " +
      'Output ONLY a JSON object with keys: name, levels (id, name, rank 0-100, description, breachSeverity, ' +
      'sharing{anyoneLinks,organizationLinks,externalGuests,publicSites,maxAudience}, labels{required,acceptedLabels,minimumPriority}, ' +
      'retention{maxAgeDays,action,reference}, locations{allowedSitePatterns,blockedSitePatterns,allowOneDrive,allowedDepartments}), ' +
      'defaultLevel, contentRules (id, description, level, classifiers, minCount, minDistinct). ' +
      'Valid classifier ids: nz-ird-number, nz-bank-account, nz-driver-licence, nz-passport, nz-nhi, credit-card, au-tfn, ' +
      'email-address, phone-number, secret-credential, health-information, personal-information. ' +
      'Only include rules stated or clearly implied by the document. Do not quote personal information.',
    user: `Policy document:\n"""\n${documentText.slice(0, maxChars)}\n"""`,
  };
}

/** Parse and validate an LLM response into a draft (invalid output is reported, not applied). */
export function parseLlmPolicyDraft(
  responseText: string,
  sourceName: string,
): PolicyDraftResult | { error: string } {
  const jsonText = responseText.slice(responseText.indexOf('{'), responseText.lastIndexOf('}') + 1);
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return { error: 'The model did not return JSON.' };
  }
  const parsed = PolicySchema.safeParse({
    ...(raw as object),
    sources: [sourceName],
    version: 'draft',
  });
  if (!parsed.success)
    return {
      error: `Model output did not match the policy schema: ${parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    };
  return {
    draft: parsed.data,
    notes: ['Drafted by the client-hosted language model — review every level and rule.'],
    method: 'llm',
  };
}
