/**
 * OVR-003 — External guest access.
 *
 * Guests (B2B accounts, partner staff, old agency contacts) on sites or items.
 * Riskiest when the site holds sensitive content or when guests are dormant.
 */
import type { RuleDefinition } from '../types';
import { eachSite, severityOf } from './helpers';

export const externalGuestsRule: RuleDefinition = {
  id: 'OVR-003',
  name: 'External guest access',
  category: 'oversharing',
  kind: 'risk',
  description: 'Finds sites and items shared with external guest accounts.',
  rationale:
    'Guest access is rarely reviewed. Partners leave, projects close, but the access remains. Guests on sites with sensitive content are a direct data-exfiltration path.',
  evaluate(ctx) {
    return eachSite(ctx).flatMap(({ site, locations, grants }) => {
      const ext = grants.filter((g) => g.scope === 'external-guest');
      if (!ext.length) return [];
      const guests = ext.reduce((s, g) => s + Math.max(1, g.externalPrincipalCount), 0);
      const sensitiveHere = locations.filter((l) => ctx.index.isSensitive(l)).length;
      const onSensitive = ext.filter((g) => {
        const l = ctx.index.locationsById.get(g.locationExternalId);
        return l ? ctx.index.isSensitive(l) && l.kind !== 'site' && l.kind !== 'team' : false;
      }).length;
      return [
        {
          ruleId: 'OVR-003',
          key: site.externalId,
          kind: 'risk' as const,
          category: 'oversharing' as const,
          severity: severityOf(
            [
              [onSensitive > 0, 'high'],
              [sensitiveHere > 0, 'high'],
            ],
            'medium',
          ),
          title: `${guests} external guest grant(s) on "${site.name}"`,
          summary: `${sensitiveHere} sensitive location(s) on this site; ${onSensitive} shared directly with guests.`,
          evidence: {
            grants: ext.map((g) => ({
              location:
                ctx.index.locationsById.get(g.locationExternalId)?.name ?? g.locationExternalId,
              guests: Math.max(1, g.externalPrincipalCount),
              access: g.roles.join(', '),
            })),
            sensitiveLocationsOnSite: sensitiveHere,
          },
          siteExternalId: site.externalId,
          departmentName: site.ownerDepartment,
          affectedCount: guests,
          monthlyImpact: null,
          recommendation: {
            title: 'Review and expire guest access',
            steps: [
              `Ask the owner of "${site.name}" to confirm each guest still needs access; remove the rest.`,
              'Enable Entra ID access reviews for guests on Microsoft 365 groups/Teams (quarterly).',
              'Set guest access expiration in SharePoint admin center (e.g. 90 days).',
              'Move sensitive folders out of guest-enabled sites, or apply a label that blocks external sharing.',
            ],
            audience: ['IT'],
            effort: 'medium',
            impact: sensitiveHere > 0 ? 'high' : 'medium',
          },
        },
      ];
    });
  },
};
