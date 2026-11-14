import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '@aiv/core';
import { buildIndex } from '../context';
import { AS_OF, batch, daysAgo, grant, item, sensitive, site, withPeople } from '../test-builders';
import type { RuleContext, RuleDefinition } from '../types';
import { RULES } from './index';
import { anyoneLinksRule } from './ovr-001-anyone-links';
import { orgWideLinksRule } from './ovr-002-org-wide-links';
import { externalGuestsRule } from './ovr-003-external-guests';
import { broadAccessSitesRule } from './ovr-004-broad-access-sites';
import { staleContentRule } from './ovr-005-stale-content';
import { brokenInheritanceRule } from './ovr-006-broken-inheritance';
import { unlabeledSensitiveRule } from './lab-001-unlabeled-sensitive';
import { dormantAccessRule } from './idn-001-dormant-access';
import { copilotReadinessRule } from './rdy-001-copilot-readiness';
import { licenceWasteRule } from './lic-001-licence-waste';
import { departmentUnderuseRule } from './ado-001-department-underuse';
import { capabilityGapsRule } from './cap-001-capability-gaps';
import { spendVsAdoptionRule } from './spd-001-spend-vs-adoption';
import { valueOpportunityRule } from './val-001-value-opportunity';

function run(rule: RuleDefinition, data: ReturnType<typeof batch>) {
  const ctx: RuleContext = {
    data,
    index: buildIndex(data, DEFAULT_ASSUMPTIONS, AS_OF),
    assumptions: DEFAULT_ASSUMPTIONS,
    asOf: AS_OF,
  };
  return rule.evaluate(ctx);
}

describe('rule registry', () => {
  it('has unique ids and complete documentation', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RULES) {
      expect(r.id).toMatch(/^[A-Z]{3}-\d{3}$/);
      expect(r.description.length).toBeGreaterThan(10);
      expect(r.rationale.length).toBeGreaterThan(20);
    }
  });
  it('returns nothing on an empty tenant', () => {
    for (const r of RULES) expect(run(r, batch())).toEqual([]);
  });
});

describe('OVR-001 anyone links', () => {
  it('is critical when on sensitive content, medium otherwise', () => {
    const data = batch({
      locations: [site('s1'), item('a', 's1', sensitive), site('s2'), item('b', 's2')],
      grants: [grant('a', 'anyone'), grant('b', 'anyone')],
    });
    const f = run(anyoneLinksRule, data);
    expect(f.find((x) => x.siteExternalId === 's1')?.severity).toBe('critical');
    expect(f.find((x) => x.siteExternalId === 's2')?.severity).toBe('medium');
  });
  it('ignores inherited grants', () => {
    const data = batch({
      locations: [site('s1'), item('a', 's1')],
      grants: [grant('a', 'anyone', { inherited: true })],
    });
    expect(run(anyoneLinksRule, data)).toEqual([]);
  });
});

describe('OVR-002 org-wide links', () => {
  it('only flags org links on sensitive content', () => {
    const data = batch({
      locations: [site('s1'), item('a', 's1', sensitive), item('b', 's1')],
      grants: [grant('a', 'organization'), grant('b', 'organization')],
    });
    const [f] = run(orgWideLinksRule, data);
    expect(f?.affectedCount).toBe(1);
  });
});

describe('OVR-003 external guests', () => {
  it('is high when the site holds sensitive content', () => {
    const data = batch({
      locations: [site('s1'), item('a', 's1', sensitive)],
      grants: [grant('s1', 'external-guest', { externalPrincipalCount: 4 })],
    });
    const [f] = run(externalGuestsRule, data);
    expect(f).toMatchObject({ severity: 'high', affectedCount: 4 });
  });
});

describe('OVR-004 broad-access sites', () => {
  it('is critical for public site with unlabelled sensitive content', () => {
    const data = batch({
      locations: [site('s1', { visibility: 'public' }), item('a', 's1', sensitive)],
    });
    expect(run(broadAccessSitesRule, data)[0]?.severity).toBe('critical');
  });
  it('is high when sensitive content is labelled', () => {
    const data = batch({
      locations: [
        site('s1', { visibility: 'public' }),
        item('a', 's1', { ...sensitive, sensitivityLabelId: 'lbl-conf' }),
      ],
    });
    expect(run(broadAccessSitesRule, data)[0]?.severity).toBe('high');
  });
  it('ignores private small sites', () => {
    expect(
      run(broadAccessSitesRule, batch({ locations: [site('s1'), item('a', 's1', sensitive)] })),
    ).toEqual([]);
  });
});

describe('OVR-005 stale content', () => {
  it('flags stale, broadly reachable sites', () => {
    const data = batch({
      locations: [
        site('s1', { visibility: 'public', lastModifiedAt: daysAgo(1000) }),
        site('s2', { lastModifiedAt: daysAgo(1000) }),
      ],
    });
    const f = run(staleContentRule, data);
    expect(f.map((x) => x.siteExternalId)).toEqual(['s1']);
  });
});

describe('OVR-006 broken inheritance', () => {
  it('needs at least two unique-permission items', () => {
    const one = batch({ locations: [site('s1'), item('a', 's1', { hasUniquePermissions: true })] });
    const three = batch({
      locations: [
        site('s1'),
        ...['a', 'b', 'c'].map((i) => item(i, 's1', { hasUniquePermissions: true, ...sensitive })),
      ],
    });
    expect(run(brokenInheritanceRule, one)).toEqual([]);
    expect(run(brokenInheritanceRule, three)[0]?.severity).toBe('medium');
  });
});

describe('LAB-001 unlabelled sensitive', () => {
  it('flags unlabelled sensitive items, not labelled ones', () => {
    const data = batch({
      locations: [
        site('s1'),
        item('a', 's1', sensitive),
        item('b', 's1', { ...sensitive, sensitivityLabelId: 'lbl-conf' }),
      ],
    });
    expect(run(unlabeledSensitiveRule, data)[0]?.affectedCount).toBe(1);
  });
});

describe('IDN-001 dormant access', () => {
  it('flags disabled licensed users and dormant guests', () => {
    const data = withPeople(batch(), 'Ops', [
      { licensed: true, lastActiveDaysAgo: null, enabled: false },
    ]);
    data.identities.push({
      externalId: 'g',
      displayName: 'G',
      email: null,
      departmentName: null,
      jobTitle: null,
      isGuest: true,
      accountEnabled: true,
      lastSignInAt: daysAgo(200),
    });
    const [f] = run(dormantAccessRule, data);
    expect(f?.affectedCount).toBe(2);
    expect(f?.monthlyImpact).toBe(DEFAULT_ASSUMPTIONS.copilotSeatMonthlyCost);
  });
});

describe('RDY-001 Copilot readiness', () => {
  it('flags low-readiness sites only', () => {
    const bad = batch({
      locations: [
        site('s1', { visibility: 'public' }),
        item('a', 's1', sensitive),
        item('b', 's1', sensitive),
      ],
      grants: [grant('a', 'anyone'), grant('b', 'organization'), grant('s1', 'external-guest')],
    });
    expect(run(copilotReadinessRule, bad)[0]?.severity).toBe('high');
    expect(run(copilotReadinessRule, batch({ locations: [site('s1')] }))).toEqual([]);
  });
});

describe('LIC-001 licence waste', () => {
  it('counts licensed users inactive beyond the threshold', () => {
    const data = withPeople(batch(), 'Sales', [
      { licensed: true, lastActiveDaysAgo: 2 },
      { licensed: true, lastActiveDaysAgo: 60 },
      { licensed: true, lastActiveDaysAgo: null },
      { licensed: false, lastActiveDaysAgo: null },
    ]);
    const [f] = run(licenceWasteRule, data);
    expect(f?.affectedCount).toBe(2);
    expect(f?.monthlyImpact).toBe(2 * DEFAULT_ASSUMPTIONS.copilotSeatMonthlyCost);
    expect(f?.severity).toBe('high');
  });
});

describe('ADO-001 department under-use', () => {
  it('flags departments below the adoption target', () => {
    const data = withPeople(batch(), 'Finance', [
      { licensed: true, lastActiveDaysAgo: 1 },
      { licensed: true, lastActiveDaysAgo: null },
      { licensed: true, lastActiveDaysAgo: null },
      { licensed: true, lastActiveDaysAgo: null },
    ]);
    withPeople(
      data,
      'Sales',
      [1, 2, 3].map(() => ({ licensed: true, lastActiveDaysAgo: 1 })),
    );
    const f = run(departmentUnderuseRule, data);
    expect(f.map((x) => x.departmentName)).toEqual(['Finance']);
    expect(f[0]?.severity).toBe('high');
  });
});

describe('CAP-001 capability gaps', () => {
  it('flags departments using few apps and suggests training for the least-used', () => {
    const data = withPeople(batch(), 'Ops', [
      { licensed: true, lastActiveDaysAgo: 1, apps: ['teams'] },
      { licensed: true, lastActiveDaysAgo: 1, apps: ['teams', 'outlook'] },
    ]);
    const [f] = run(capabilityGapsRule, data);
    expect(f?.departmentName).toBe('Ops');
    expect(f?.recommendation.steps.some((s) => s.startsWith('Training:'))).toBe(true);
  });
});

describe('SPD-001 spend vs adoption', () => {
  it('flags poor ROI', () => {
    const data = withPeople(batch(), 'X', [
      { licensed: true, lastActiveDaysAgo: null },
      { licensed: true, lastActiveDaysAgo: null },
      { licensed: true, lastActiveDaysAgo: 1, activeDays: 2 },
    ]);
    const [f] = run(spendVsAdoptionRule, data);
    expect(f?.severity).toBe('high');
  });
});

describe('VAL-001 value opportunity', () => {
  it('estimates uplift from moving inactive/light users to regular use', () => {
    const data = withPeople(batch(), 'X', [
      { licensed: true, lastActiveDaysAgo: null },
      { licensed: true, lastActiveDaysAgo: 1, activeDays: 20 },
    ]);
    const [f] = run(valueOpportunityRule, data);
    const a = DEFAULT_ASSUMPTIONS;
    const expected = Math.round(
      a.hoursSavedPerWeekRegularUser * 4.33 * a.loadedHourlyCost * a.valueConfidenceFactor,
    );
    expect(f?.monthlyImpact).toBe(expected);
  });
});
