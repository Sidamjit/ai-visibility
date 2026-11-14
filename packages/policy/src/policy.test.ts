import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ClassifierHit } from '@aiv/core';
import {
  NZ_PSR_SAMPLE_POLICY,
  PolicySchema,
  classifyScan,
  draftPolicyHeuristically,
  evaluateHandling,
  globToRegExp,
  levelById,
  lintPolicy,
  parseLlmPolicyDraft,
  parsePolicy,
  type ExposureFacts,
} from './index';

const policy = PolicySchema.parse(NZ_PSR_SAMPLE_POLICY);
const hit = (
  classifierId: string,
  count: number,
  distinctValues = count,
  confidence: ClassifierHit['confidence'] = 'high',
): ClassifierHit => ({
  classifierId,
  category: 'government-id',
  count,
  distinctValues,
  confidence,
  snippets: [],
});
const facts = (over: Partial<ExposureFacts> = {}): ExposureFacts => ({
  anyoneLinks: 0,
  organizationLinks: 0,
  externalPrincipals: 0,
  publicSite: false,
  audienceSize: 10,
  label: { name: 'Highly Confidential', priority: 3 },
  siteName: 'Legal',
  siteUrl: 'https://contoso.sharepoint.com/sites/legal',
  department: 'Legal',
  isOneDrive: false,
  lastModifiedAt: '2026-10-01T00:00:00Z',
  asOf: new Date('2026-11-01T00:00:00Z'),
  ...over,
});

describe('policy schema & io', () => {
  it('sample YAML file is identical to the TypeScript sample', () => {
    const yaml = readFileSync(new URL('../samples/nz-psr-sample.yaml', import.meta.url), 'utf8');
    const parsed = parsePolicy(yaml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.policy).toEqual(policy);
  });

  it('rejects duplicate ranks, unknown default level and rules pointing to unknown levels', () => {
    const bad = parsePolicy(
      JSON.stringify({
        name: 'x',
        defaultLevel: 'NOPE',
        levels: [
          { id: 'A', name: 'A', rank: 1 },
          { id: 'B', name: 'B', rank: 1 },
        ],
        contentRules: [{ id: 'r', level: 'C', classifiers: ['credit-card'] }],
      }),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.join('\n')).toMatch(/duplicate rank/);
      expect(bad.errors.join('\n')).toMatch(/defaultLevel: unknown level/);
      expect(bad.errors.join('\n')).toMatch(/unknown level "C"/);
    }
  });

  it('reports YAML syntax errors and invalid custom regexes', () => {
    expect(parsePolicy('levels: [').ok).toBe(false);
    const r = parsePolicy(
      JSON.stringify({
        name: 'x',
        defaultLevel: 'A',
        levels: [{ id: 'A', name: 'A', rank: 0 }],
        classifiers: { custom: [{ id: 'c', name: 'c', pattern: '([' }] },
      }),
    );
    expect(r.ok).toBe(false);
  });

  it('fills defaults so minimal policies are valid', () => {
    const r = parsePolicy(
      'name: Minimal\ndefaultLevel: OPEN\nlevels:\n  - id: OPEN\n    name: Open\n    rank: 0\n',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.policy.levels[0]!.sharing.anyoneLinks).toBe(false);
  });

  it('lints rules that reference unknown classifiers', () => {
    const warnings = lintPolicy(policy, ['credit-card']);
    expect(warnings.some((w) => w.includes('nz-nhi'))).toBe(true);
    expect(warnings.some((w) => w.includes('legal-privilege'))).toBe(false); // custom classifier
  });
});

describe('classifyScan', () => {
  it('uses the default level when nothing matches', () => {
    expect(classifyScan(policy, []).level.id).toBe('UNCLASSIFIED');
    expect(classifyScan(policy, []).source).toBe('default');
  });

  it('applies count, distinct and confidence thresholds', () => {
    expect(classifyScan(policy, [hit('nz-ird-number', 1)]).level.id).toBe('IN-CONFIDENCE');
    expect(classifyScan(policy, [hit('nz-ird-number', 9, 5)]).level.id).toBe('SENSITIVE');
    expect(classifyScan(policy, [hit('nz-ird-number', 3, 3, 'low')]).level.id).toBe('UNCLASSIFIED');
    expect(classifyScan(policy, [hit('credit-card', 1, 1, 'medium')]).level.id).toBe(
      'UNCLASSIFIED',
    );
  });

  it('picks the highest level among matching rules and lists all matches', () => {
    const r = classifyScan(policy, [hit('nz-ird-number', 1), hit('nz-nhi', 12, 12)]);
    expect(r.level.id).toBe('RESTRICTED');
    expect(r.matchedRules.map((m) => m.ruleId)).toEqual(
      expect.arrayContaining(['bulk-health', 'health-info', 'individual-tax-or-bank']),
    );
    expect(r.matchedRules[0]!.levelId).toBe('RESTRICTED');
  });

  it('lets a confident LLM raise but never lower the level', () => {
    const llm = { provider: 'x', model: 'm', categories: [], rationale: '', confidence: 0.9 };
    expect(classifyScan(policy, [], { ...llm, levelId: 'SENSITIVE' }).level.id).toBe('SENSITIVE');
    expect(
      classifyScan(policy, [hit('nz-nhi', 12, 12)], { ...llm, levelId: 'IN-CONFIDENCE' }).level.id,
    ).toBe('RESTRICTED');
    expect(
      classifyScan(policy, [], { ...llm, levelId: 'SENSITIVE', confidence: 0.4 }).level.id,
    ).toBe('UNCLASSIFIED');
  });
});

describe('evaluateHandling', () => {
  const restricted = levelById(policy, 'RESTRICTED');
  const sensitive = levelById(policy, 'SENSITIVE');
  const types = (level = restricted, f: Partial<ExposureFacts> = {}) =>
    evaluateHandling(level, facts(f)).map((b) => b.type);

  it('is compliant for correctly handled content', () => {
    expect(types()).toEqual([]);
  });

  it('flags sharing breaches', () => {
    expect(
      types(restricted, { anyoneLinks: 1, organizationLinks: 2, externalPrincipals: 3 }),
    ).toEqual(['anyone-link', 'organization-link', 'external-guest']);
  });

  it('flags audience breaches', () => {
    expect(types(restricted, { publicSite: true, audienceSize: 900 })).toEqual([
      'public-site',
      'audience-exceeded',
    ]);
    expect(types(restricted, { audienceSize: null })).toEqual([]);
  });

  it('flags missing and insufficient labels', () => {
    expect(types(restricted, { label: null })).toEqual(['label-missing']);
    expect(types(restricted, { label: { name: 'Confidential', priority: 2 } })).toEqual([
      'label-insufficient',
    ]);
    expect(types(sensitive, { label: { name: 'Confidential', priority: 2 } })).toEqual([]);
  });

  it('flags location breaches (allow list, block list, OneDrive)', () => {
    expect(
      types(restricted, { siteName: 'Marketing', siteUrl: 'https://x/sites/marketing' }),
    ).toEqual(['location-not-allowed']);
    expect(types(sensitive, { siteName: 'All Staff News', siteUrl: null })).toEqual([
      'location-blocked',
    ]);
    expect(
      types(restricted, { isOneDrive: true, siteName: 'OneDrive - Jo', siteUrl: null }),
    ).toEqual(['onedrive-not-allowed']);
  });

  it('flags retention breaches using last modified date', () => {
    const r = evaluateHandling(restricted, facts({ lastModifiedAt: '2018-01-01T00:00:00Z' }));
    expect(r.map((b) => b.type)).toEqual(['retention-exceeded']);
    expect(r[0]!.message).toMatch(/2555 days/);
  });

  it('allows everything at UNCLASSIFIED', () => {
    expect(
      types(levelById(policy, 'UNCLASSIFIED'), {
        anyoneLinks: 5,
        publicSite: true,
        label: null,
        isOneDrive: true,
      }),
    ).toEqual([]);
  });
});

describe('drafting from documents', () => {
  it('detects markings and retention without an LLM', () => {
    const text = `
      Information is classified as UNCLASSIFIED, IN-CONFIDENCE, SENSITIVE or RESTRICTED.
      IN-CONFIDENCE material must not be shared with external parties without approval.
      SENSITIVE and RESTRICTED material is limited to named staff. RESTRICTED records are reviewed.
      UNCLASSIFIED documents may be published. Records must be retained for 10 years after closure.
      Financial records are kept for 10 years.`;
    const r = draftPolicyHeuristically(text, 'Info Mgmt Policy.docx');
    const parsed = PolicySchema.parse(r.draft);
    expect(parsed.levels.map((l) => l.id)).toEqual([
      'UNCLASSIFIED',
      'IN-CONFIDENCE',
      'SENSITIVE',
      'RESTRICTED',
    ]);
    expect(parsed.levels[1]!.retention.maxAgeDays).toBe(3650);
    expect(r.notes.join(' ')).toMatch(/10 year/);
    expect(parsed.sources).toEqual(['Info Mgmt Policy.docx']);
  });

  it('falls back to the sample levels when the document has no markings', () => {
    const r = draftPolicyHeuristically('This policy is about records.', 'x.pdf');
    expect(PolicySchema.parse(r.draft).levels).toHaveLength(4);
  });

  it('validates LLM output and reports schema problems', () => {
    expect('error' in parseLlmPolicyDraft('not json', 'x')).toBe(true);
    const ok = parseLlmPolicyDraft(
      `Here: {"name":"P","defaultLevel":"OPEN","levels":[{"id":"OPEN","name":"Open","rank":0}]}`,
      'x',
    );
    expect('draft' in ok && ok.method).toBe('llm');
  });
});

describe('glob', () => {
  it('matches case-insensitively with wildcards', () => {
    expect(globToRegExp('*legal*').test('Group LEGAL Advice')).toBe(true);
    expect(globToRegExp('hr').test('hr team')).toBe(false);
    expect(globToRegExp('fin?nce').test('Finance')).toBe(true);
  });
});
