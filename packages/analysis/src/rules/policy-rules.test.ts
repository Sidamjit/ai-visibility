import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '@aiv/core';
import { NZ_PSR_SAMPLE_POLICY, PolicySchema, type Policy } from '@aiv/policy';
import { buildIndex } from '../context';
import { AS_OF, batch, daysAgo, grant, item, scan, site } from '../test-builders';
import type { RuleContext, RuleDefinition } from '../types';
import { policySharingRule } from './pol-001-sharing';
import { policyAudienceRule } from './pol-002-audience';
import { policyLabelRule } from './pol-003-labels';
import { policyLocationRule } from './pol-004-location';
import { policyRetentionRule } from './pol-005-retention';
import { secretsInContentRule } from './sec-001-secrets-in-content';

const policy = PolicySchema.parse(NZ_PSR_SAMPLE_POLICY);
const labelled = { sensitivityLabelId: 'lbl-hc' };
const labels = [
  { externalId: 'lbl-general', name: 'General', priority: 1, isSensitive: false },
  { externalId: 'lbl-conf', name: 'Confidential', priority: 2, isSensitive: true },
  { externalId: 'lbl-hc', name: 'Highly Confidential', priority: 3, isSensitive: true },
];

function run(rule: RuleDefinition, data: ReturnType<typeof batch>, p: Policy | null = policy) {
  const ctx: RuleContext = {
    data,
    index: buildIndex(data, DEFAULT_ASSUMPTIONS, AS_OF, p),
    assumptions: DEFAULT_ASSUMPTIONS,
    policy: p,
    asOf: AS_OF,
  };
  return rule.evaluate(ctx);
}

/** One private, well-run "Legal" site with a payroll export; tests vary one thing at a time. */
function legalSite(
  fileOver = {},
  siteOver = {},
  hits: Array<[string, number, number?]> = [['nz-ird-number', 40, 40]],
) {
  return batch({
    labels,
    locations: [
      site('s1', { name: 'Legal', memberCount: 12, ...siteOver }),
      item('f1', 's1', { name: 'Payroll export.csv', ...labelled, ...fileOver }),
    ],
    contentScans: [scan('f1', 's1', hits)],
  });
}

describe('policy rules (content classification vs handling)', () => {
  it('raise nothing for correctly handled classified content', () => {
    for (const rule of [
      policySharingRule,
      policyAudienceRule,
      policyLabelRule,
      policyLocationRule,
      policyRetentionRule,
    ])
      expect(run(rule, legalSite()), rule.id).toEqual([]);
  });

  it('skip entirely without a policy or without scans', () => {
    expect(run(policySharingRule, legalSite(), null)).toEqual([]);
    const b = legalSite();
    b.contentScans = [];
    b.grants.push(grant('f1', 'anyone'));
    expect(run(policySharingRule, b)).toEqual([]);
  });

  it('POL-001 flags anyone/org/guest sharing of SENSITIVE content, with evidence', () => {
    const b = legalSite();
    b.grants.push(
      grant('f1', 'anyone'),
      grant('f1', 'external-guest', { grantedToExternalIds: ['g1'] }),
    );
    b.identities.push({
      externalId: 'g1',
      displayName: 'Gail Guest',
      email: null,
      departmentName: null,
      jobTitle: null,
      isGuest: true,
      accountEnabled: true,
      lastSignInAt: null,
    });
    const [f] = run(policySharingRule, b);
    expect(f).toMatchObject({
      ruleId: 'POL-001',
      severity: 'high',
      affectedCount: 1,
      category: 'policy',
    });
    const ev = (f!.evidence.files as Array<Record<string, unknown>>)[0]!;
    expect(ev.classification).toBe('Sensitive');
    expect(ev.detected).toBe('nz-ird-number ×40');
    expect(String(ev.whoHasAccess)).toContain('Gail Guest');
    expect((ev.breaches as string[]).join(' ')).toMatch(/anonymous links/);
  });

  it('uses the level severity: RESTRICTED breaches are critical', () => {
    const b = legalSite({}, {}, [['nz-nhi', 12, 12]]);
    b.grants.push(grant('f1', 'organization'));
    expect(run(policySharingRule, b)[0]!.severity).toBe('critical');
  });

  it('POL-002 flags public sites and audiences above the cap', () => {
    const b = legalSite({}, { visibility: 'public', memberCount: 400 });
    const [f] = run(policyAudienceRule, b);
    expect(f!.summary).toMatch(/public-site, audience-exceeded/);
  });

  it('POL-003 flags missing / too-low labels one notch below the level severity', () => {
    expect(run(policyLabelRule, legalSite({ sensitivityLabelId: null }))[0]).toMatchObject({
      severity: 'medium',
    });
    expect(run(policyLabelRule, legalSite({ sensitivityLabelId: 'lbl-general' }))).toHaveLength(1);
    expect(run(policyLabelRule, legalSite({ sensitivityLabelId: 'lbl-conf' }))).toEqual([]); // SENSITIVE accepts priority 2
  });

  it('POL-004 flags RESTRICTED content outside approved sites', () => {
    const b = legalSite({}, { name: 'Marketing', webUrl: 'https://x/sites/marketing' }, [
      ['legal-privilege', 2],
    ]);
    const [f] = run(policyLocationRule, b);
    expect(f!.title).toMatch(/outside approved locations/);
  });

  it('POL-005 flags content past retention', () => {
    const [f] = run(policyRetentionRule, legalSite({ lastModifiedAt: daysAgo(3000) }));
    expect(f).toMatchObject({ severity: 'low' });
  });

  it('SEC-001 flags credentials; critical when exposed, regardless of level rules', () => {
    const hidden = legalSite({}, {}, [['secret-credential', 4]]);
    expect(run(secretsInContentRule, hidden)[0]).toMatchObject({ severity: 'high' });
    hidden.grants.push(grant('f1', 'organization'));
    expect(run(secretsInContentRule, hidden)[0]).toMatchObject({ severity: 'critical' });
    expect(JSON.stringify(run(secretsInContentRule, hidden))).toMatch(/never stored/);
  });

  it('inherits exposure from parent folders and the site guest membership', () => {
    const b = legalSite({ parentExternalId: 'fold' });
    b.locations.push(item('fold', 's1', { kind: 'folder', name: 'HR' }));
    b.grants.push(
      grant('fold', 'anyone'),
      grant('s1', 'external-guest', { externalPrincipalCount: 3 }),
    );
    const f = run(policySharingRule, b)[0]!;
    expect((f.evidence.files as Array<{ whoHasAccess: string }>)[0]!.whoHasAccess).toMatch(
      /1 anyone link\(s\).*3 external/,
    );
  });

  it('makes content-classified files count as sensitive for the other rules', () => {
    const data = legalSite({ name: 'notes.docx', sensitivityLabelId: null });
    const idx = buildIndex(data, DEFAULT_ASSUMPTIONS, AS_OF, policy);
    expect(idx.isSensitive(data.locations[1]!)).toBe(true);
    expect(buildIndex(data, DEFAULT_ASSUMPTIONS, AS_OF, null).isSensitive(data.locations[1]!)).toBe(
      false,
    );
  });
});
