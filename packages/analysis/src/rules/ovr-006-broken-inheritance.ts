/**
 * OVR-006 — Broken permission inheritance.
 *
 * Items with unique permissions make access impossible to reason about at
 * site level and are where ad-hoc oversharing accumulates.
 */
import type { RuleDefinition } from '../types';
import { eachSite } from './helpers';

export const brokenInheritanceRule: RuleDefinition = {
  id: 'OVR-006',
  name: 'Broken permission inheritance',
  category: 'oversharing',
  kind: 'risk',
  description: 'Sites with several files/folders that carry unique (non-inherited) permissions.',
  rationale:
    'Unique permissions fragment access control: site owners can no longer see who has access, reviews miss item-level grants, and cleanup becomes manual.',
  evaluate(ctx) {
    return eachSite(ctx).flatMap(({ site, locations }) => {
      const unique = locations.filter((l) => l.hasUniquePermissions && l.parentExternalId !== null);
      if (unique.length < 2) return [];
      const sensitive = unique.filter((l) => ctx.index.isSensitive(l)).length;
      return [
        {
          ruleId: 'OVR-006',
          key: site.externalId,
          kind: 'risk' as const,
          category: 'oversharing' as const,
          severity: sensitive > 0 && unique.length >= 3 ? ('medium' as const) : ('low' as const),
          title: `${unique.length} items with unique permissions in "${site.name}"`,
          summary: `${sensitive} of them look sensitive.`,
          evidence: {
            items: unique.map((l) => ({
              name: l.name,
              kind: l.kind,
              sensitive: ctx.index.isSensitive(l),
            })),
          },
          siteExternalId: site.externalId,
          departmentName: site.ownerDepartment,
          affectedCount: unique.length,
          monthlyImpact: null,
          recommendation: {
            title: 'Restore inheritance and use structure instead of item-level sharing',
            steps: [
              'Run a SharePoint Advanced Management "Data access governance" report for this site to list unique permissions.',
              'Where the extra access is not needed, "Delete unique permissions" to restore inheritance.',
              'Where a subset genuinely needs different access, move it to its own library or site.',
            ],
            audience: ['IT'],
            effort: 'medium',
            impact: 'medium',
          },
        },
      ];
    });
  },
};
