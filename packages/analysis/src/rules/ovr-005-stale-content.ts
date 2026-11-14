/**
 * OVR-005 — Stale content still reachable by Copilot.
 *
 * Old project sites and archives are rarely needed but, if broadly accessible,
 * still feed Copilot answers (outdated pricing, old HR files, closed projects).
 */
import type { RuleDefinition } from '../types';
import { eachSite, severityOf } from './helpers';

export const staleContentRule: RuleDefinition = {
  id: 'OVR-005',
  name: 'Stale content reachable by Copilot',
  category: 'oversharing',
  kind: 'risk',
  description:
    'Sites not modified for a long time that are still broadly reachable (public, large, or link-shared).',
  rationale:
    'Stale content increases breach impact and degrades Copilot answer quality (outdated or superseded documents get cited). Archiving it reduces both risk and noise.',
  evaluate(ctx) {
    return eachSite(ctx).flatMap(({ site, locations, grants }) => {
      if (!ctx.index.isStale(site)) return [];
      const reachable =
        ctx.index.isBroadSite(site) ||
        (site.memberCount ?? 0) > 50 ||
        grants.some((g) => g.scope === 'anyone' || g.scope === 'organization');
      if (!reachable) return [];
      const sensitive = locations.filter((l) => ctx.index.isSensitive(l)).length;
      const years = site.lastModifiedAt
        ? (
            (ctx.asOf.getTime() - new Date(site.lastModifiedAt).getTime()) /
            (365 * 86_400_000)
          ).toFixed(1)
        : 'unknown';
      return [
        {
          ruleId: 'OVR-005',
          key: site.externalId,
          kind: 'risk' as const,
          category: 'oversharing' as const,
          severity: severityOf([[sensitive > 0, 'high']], 'medium'),
          title: `"${site.name}" untouched for ${years} years but still broadly reachable`,
          summary: `${site.memberCount ?? '?'} members, visibility ${site.visibility}, ${sensitive} sensitive item(s).`,
          evidence: {
            lastModifiedAt: site.lastModifiedAt,
            memberCount: site.memberCount,
            visibility: site.visibility,
            sensitiveItems: sensitive,
          },
          siteExternalId: site.externalId,
          departmentName: site.ownerDepartment,
          affectedCount: 1,
          monthlyImpact: null,
          recommendation: {
            title: 'Archive or lock down stale sites',
            steps: [
              'Confirm with the owner (or department head if the owner left) whether the site is still needed.',
              'Archive with Microsoft 365 Archive, or set the site to read-only and remove broad membership.',
              'Apply a retention policy so content is deleted when its retention period ends.',
              'Enable Restricted Content Discovery on the site until it is archived.',
            ],
            audience: ['IT'],
            effort: 'low',
            impact: sensitive > 0 ? 'high' : 'medium',
          },
        },
      ];
    });
  },
};
