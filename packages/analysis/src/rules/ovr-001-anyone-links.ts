/**
 * OVR-001 — "Anyone" (anonymous) sharing links.
 *
 * Anyone links work without sign-in, can be forwarded endlessly and leave no
 * identity in the audit trail. On sensitive content they are the single most
 * common cause of SharePoint/OneDrive data breaches.
 */
import type { RuleDefinition } from '../types';
import { describe, eachSite, severityOf } from './helpers';

export const anyoneLinksRule: RuleDefinition = {
  id: 'OVR-001',
  name: 'Anyone links (no sign-in required)',
  category: 'oversharing',
  kind: 'risk',
  description: 'Finds files and folders shared with "Anyone with the link", per site.',
  rationale:
    'Anonymous links bypass identity, conditional access and audit. Anyone who obtains the URL (forwarded email, chat, search index) can open the content.',
  evaluate(ctx) {
    return eachSite(ctx).flatMap(({ site, grants }) => {
      const anyone = grants.filter((g) => g.scope === 'anyone');
      if (!anyone.length) return [];
      const items = anyone.map((g) => {
        const loc = ctx.index.locationsById.get(g.locationExternalId);
        return {
          ...(loc ? describe(ctx, loc) : { id: g.locationExternalId, name: '(unknown)' }),
          access: g.roles.join(', '),
          expires: g.expiresAt,
        };
      });
      const onSensitive = items.filter((i) => 'sensitive' in i && i.sensitive).length;
      const editable = anyone.filter((g) =>
        g.roles.some((r) => r === 'write' || r === 'edit'),
      ).length;
      const noExpiry = anyone.filter((g) => !g.expiresAt).length;
      return [
        {
          ruleId: 'OVR-001',
          key: site.externalId,
          kind: 'risk' as const,
          category: 'oversharing' as const,
          severity: severityOf(
            [
              [onSensitive > 0, 'critical'],
              [editable > 0, 'high'],
            ],
            'medium',
          ),
          title: `${anyone.length} anyone link(s) in "${site.name}"`,
          summary: `${onSensitive} on sensitive content, ${editable} allow editing, ${noExpiry} never expire.`,
          evidence: { items, onSensitive, editable, noExpiry },
          siteExternalId: site.externalId,
          departmentName: site.ownerDepartment,
          affectedCount: anyone.length,
          monthlyImpact: null,
          recommendation: {
            title: 'Remove anyone links and restrict anonymous sharing',
            steps: [
              `Review the ${anyone.length} link(s) listed in the evidence with the site owner of "${site.name}" and delete those not needed.`,
              'Replace required external shares with "Specific people" links to named guests.',
              'SharePoint admin center → Sites → this site → Sharing: set to "New and existing guests" or stricter.',
              'Tenant-wide: Policies → Sharing → default link type "Specific people"; anyone links expire within 30 days and are view-only.',
            ],
            audience: ['IT'],
            effort: 'low',
            impact: onSensitive > 0 ? 'high' : 'medium',
          },
        },
      ];
    });
  },
};
