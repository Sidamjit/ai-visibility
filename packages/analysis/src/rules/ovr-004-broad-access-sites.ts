/**
 * OVR-004 — Broad-access sites (public Teams/groups or very large membership)
 * that hold sensitive content.
 *
 * This is THE classic Copilot oversharing problem: content was always
 * technically accessible to everyone, but nobody found it. Copilot finds it.
 */
import type { RuleDefinition } from '../types';
import { describe, eachSite, severityOf } from './helpers';

export const broadAccessSitesRule: RuleDefinition = {
  id: 'OVR-004',
  name: 'Sensitive content on broad-access sites',
  category: 'oversharing',
  kind: 'risk',
  description:
    'Public (org-wide) sites or sites with excessive membership that contain sensitive content.',
  rationale:
    'Copilot answers from everything a user can access. A public site with payroll or HR files means any employee can ask Copilot about colleagues\' salaries or cases — "security through obscurity" ends the day Copilot is enabled.',
  evaluate(ctx) {
    const threshold = ctx.assumptions.excessiveMembershipThreshold;
    return eachSite(ctx).flatMap(({ site, locations }) => {
      if (!ctx.index.isBroadSite(site)) return [];
      const sensitive = locations.filter((l) => ctx.index.isSensitive(l));
      const unlabeled = sensitive.filter((l) => !ctx.index.hasSensitiveLabel(l));
      if (!sensitive.length && (site.memberCount ?? 0) <= threshold) return [];
      const why =
        site.visibility === 'public'
          ? 'public (anyone in the organisation can access)'
          : `${site.memberCount} members`;
      return [
        {
          ruleId: 'OVR-004',
          key: site.externalId,
          kind: 'risk' as const,
          category: 'oversharing' as const,
          severity: severityOf(
            [
              [unlabeled.length > 0, 'critical'],
              [sensitive.length > 0, 'high'],
            ],
            'low',
          ),
          title: sensitive.length
            ? `"${site.name}" is ${why} and holds ${sensitive.length} sensitive item(s)`
            : `"${site.name}" has excessive membership (${site.memberCount})`,
          summary: sensitive.length
            ? `${unlabeled.length} of them are unlabelled, so nothing stops Copilot surfacing them to any member.`
            : 'Large membership increases the blast radius of anything stored here.',
          evidence: {
            visibility: site.visibility,
            memberCount: site.memberCount,
            sensitiveItems: sensitive.map((l) => describe(ctx, l)),
          },
          siteExternalId: site.externalId,
          departmentName: site.ownerDepartment,
          affectedCount: sensitive.length || (site.memberCount ?? 0),
          monthlyImpact: null,
          recommendation: {
            title: 'Restrict the site or move sensitive content out',
            steps: [
              'Move sensitive folders to a private site whose membership matches the business need.',
              site.visibility === 'public'
                ? 'Change the Team/group privacy from Public to Private.'
                : 'Reduce membership to the people who actually need access; replace "Everyone" groups with role groups.',
              'Apply a sensitivity label to the site and to the sensitive libraries.',
              'Short-term containment: enable Restricted Content Discovery for this site so Copilot and org-wide search skip it while you fix permissions.',
            ],
            audience: ['IT'],
            effort: 'medium',
            impact: sensitive.length ? 'high' : 'medium',
          },
        },
      ];
    });
  },
};
