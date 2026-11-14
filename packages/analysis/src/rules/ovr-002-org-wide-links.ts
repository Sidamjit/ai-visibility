/**
 * OVR-002 — "People in your organisation" links on sensitive content.
 *
 * Organisation-wide links are the default in many tenants. They are often
 * forwarded far beyond the intended audience, and once redeemed the content is
 * in scope for that user's Copilot answers.
 */
import type { RuleDefinition } from '../types';
import { describe, eachSite } from './helpers';

export const orgWideLinksRule: RuleDefinition = {
  id: 'OVR-002',
  name: 'Organisation-wide links on sensitive content',
  category: 'oversharing',
  kind: 'risk',
  description: 'Finds sensitive files/folders shared with "People in your organisation" links.',
  rationale:
    'Org-wide links grant access to any employee who gets the link. On HR, finance or legal content this routinely exposes data to staff who should not see it, and Copilot will then surface it to them.',
  evaluate(ctx) {
    return eachSite(ctx).flatMap(({ site, grants }) => {
      const hits = grants
        .filter((g) => g.scope === 'organization')
        .map((g) => ctx.index.locationsById.get(g.locationExternalId))
        .filter((l): l is NonNullable<typeof l> => Boolean(l && ctx.index.isSensitive(l)));
      if (!hits.length) return [];
      return [
        {
          ruleId: 'OVR-002',
          key: site.externalId,
          kind: 'risk' as const,
          category: 'oversharing' as const,
          severity: hits.length >= 3 ? ('high' as const) : ('medium' as const),
          title: `${hits.length} sensitive item(s) shared org-wide in "${site.name}"`,
          summary: 'Sensitive content is reachable by anyone in the organisation who has the link.',
          evidence: { items: hits.map((l) => describe(ctx, l)) },
          siteExternalId: site.externalId,
          departmentName: site.ownerDepartment,
          affectedCount: hits.length,
          monthlyImpact: null,
          recommendation: {
            title: 'Replace org-wide links with specific-people sharing',
            steps: [
              'Remove the organisation-wide links listed in the evidence (Manage access → Links).',
              'Re-share with the specific people or groups that need access.',
              'Set the tenant default sharing link to "Specific people" (SharePoint admin center → Policies → Sharing).',
              'Apply a "Confidential" sensitivity label that blocks org-wide sharing on these libraries.',
            ],
            audience: ['IT'],
            effort: 'low',
            impact: 'high',
          },
        },
      ];
    });
  },
};
