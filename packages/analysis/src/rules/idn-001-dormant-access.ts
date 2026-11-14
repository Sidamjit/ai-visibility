/**
 * IDN-001 — Dormant identities that still hold access or paid seats.
 *
 * Disabled accounts with licences waste money; guests that have not signed in
 * for months still have access to whatever was shared with them.
 */
import type { RuleDefinition } from '../types';

const DAY = 86_400_000;

export const dormantAccessRule: RuleDefinition = {
  id: 'IDN-001',
  name: 'Dormant accounts with access or licences',
  category: 'identity',
  kind: 'risk',
  description: 'Disabled users still holding AI licences, and guests inactive for 90+ days.',
  rationale: 'Leavers and forgotten guests are a common breach vector and a direct licence cost.',
  evaluate(ctx) {
    const { data, index, assumptions, asOf } = ctx;
    const disabledLicensed = data.identities.filter(
      (i) => !i.accountEnabled && index.licencesByIdentity.has(i.externalId),
    );
    const dormantGuests = data.identities.filter(
      (i) =>
        i.isGuest &&
        (!i.lastSignInAt || asOf.getTime() - new Date(i.lastSignInAt).getTime() > 90 * DAY),
    );
    if (!disabledLicensed.length && !dormantGuests.length) return [];
    return [
      {
        ruleId: 'IDN-001',
        key: 'org',
        kind: 'risk',
        category: 'identity',
        severity: dormantGuests.length > 20 ? 'high' : 'medium',
        title: `${dormantGuests.length} dormant guests and ${disabledLicensed.length} disabled accounts holding licences`,
        summary: 'Accounts nobody uses still have access to content or consume paid seats.',
        evidence: {
          disabledLicensed: disabledLicensed.map((i) => ({
            name: i.displayName,
            department: i.departmentName,
          })),
          dormantGuests: dormantGuests.map((i) => ({
            name: i.displayName,
            email: i.email,
            lastSignInAt: i.lastSignInAt,
          })),
        },
        siteExternalId: null,
        departmentName: null,
        affectedCount: disabledLicensed.length + dormantGuests.length,
        monthlyImpact: disabledLicensed.length * assumptions.copilotSeatMonthlyCost,
        recommendation: {
          title: 'Clean up leavers and dormant guests',
          steps: [
            'Remove Copilot licences from disabled accounts (or use group-based licensing tied to an active-staff group).',
            'Configure Entra ID access reviews for guests with auto-removal of those not signed in for 90 days.',
            'Add licence removal to the HR leaver process.',
          ],
          audience: ['IT'],
          effort: 'low',
          impact: 'medium',
        },
      },
    ];
  },
};
