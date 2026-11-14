/**
 * LAB-001 — Sensitive-looking content without a sensitivity label.
 *
 * Labels are what DLP, encryption and Copilot's own protections key off. An
 * unlabelled payroll file is invisible to all of those controls.
 */
import type { RuleDefinition } from '../types';
import { describe, eachSite } from './helpers';

export const unlabeledSensitiveRule: RuleDefinition = {
  id: 'LAB-001',
  name: 'Sensitive content without a sensitivity label',
  category: 'labelling',
  kind: 'risk',
  description:
    'Locations whose metadata indicates sensitive content (name keywords) but carry no sensitive label.',
  rationale:
    'Microsoft Purview labels drive encryption, DLP and Copilot protections. Without a label, sensitive content is treated like any other document. This rule uses names only (triage for unscanned content); POL-003 covers files whose CONTENT was classified.',
  evaluate(ctx) {
    return eachSite(ctx).flatMap(({ site, locations }) => {
      const hits = locations.filter((l) => l.likelySensitive && !ctx.index.hasSensitiveLabel(l));
      if (!hits.length) return [];
      const broad = ctx.index.isBroadSite(site);
      return [
        {
          ruleId: 'LAB-001',
          key: site.externalId,
          kind: 'risk' as const,
          category: 'labelling' as const,
          severity: broad ? ('high' as const) : ('medium' as const),
          title: `${hits.length} unlabelled sensitive item(s) in "${site.name}"`,
          summary: `Detected from names (${[...new Set(hits.flatMap((h) => h.sensitivityReasons))].slice(0, 4).join(', ')}).`,
          evidence: {
            items: hits.map((l) => describe(ctx, l)),
            detection:
              'metadata (name keywords); content-based label breaches are reported by POL-003',
          },
          siteExternalId: site.externalId,
          departmentName: site.ownerDepartment,
          affectedCount: hits.length,
          monthlyImpact: null,
          recommendation: {
            title: 'Label sensitive content with Microsoft Purview',
            steps: [
              'Confirm with the content owner which items are genuinely sensitive.',
              'Apply "Confidential" / "Highly Confidential" labels; set a default label on the library.',
              'Turn on auto-labelling policies for common sensitive info types (bank, tax, passport numbers).',
              'Add a DLP policy that blocks external/anyone sharing of labelled content.',
            ],
            audience: ['IT'],
            effort: 'medium',
            impact: broad ? 'high' : 'medium',
          },
        },
      ];
    });
  },
};
