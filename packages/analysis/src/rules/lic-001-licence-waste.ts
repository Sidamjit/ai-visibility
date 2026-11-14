/**
 * LIC-001 — Paid Copilot seats with no recent activity.
 */
import type { RuleDefinition } from '../types';
import { money, pctText } from './helpers';

export const licenceWasteRule: RuleDefinition = {
  id: 'LIC-001',
  name: 'Inactive paid AI seats',
  category: 'licensing',
  kind: 'risk',
  description: 'Licensed users with no AI activity within the inactive-seat threshold.',
  rationale:
    'Unused seats are pure cost. Reassigning them to people who will use them turns waste into value.',
  evaluate(ctx) {
    const { index, assumptions: a } = ctx;
    const licensed = [...index.licencesByIdentity.keys()];
    const inactive = licensed.filter((id) => !index.isActiveSeat(id));
    if (!inactive.length) return [];
    const byDept: Record<string, number> = {};
    for (const id of inactive) {
      const d = index.identitiesById.get(id)?.departmentName ?? 'Unassigned';
      byDept[d] = (byDept[d] ?? 0) + 1;
    }
    const share = inactive.length / licensed.length;
    const monthly = inactive.length * a.copilotSeatMonthlyCost;
    return [
      {
        ruleId: 'LIC-001',
        key: 'org',
        kind: 'risk',
        category: 'licensing',
        severity: share > 0.3 ? 'high' : share > 0.15 ? 'medium' : 'low',
        title: `${inactive.length} of ${licensed.length} Copilot seats inactive (${pctText(share)})`,
        summary: `${money(monthly, a.currency)}/month (${money(monthly * 12, a.currency)}/year) spent on seats with no activity in ${a.inactiveSeatDays} days.`,
        evidence: {
          byDepartment: Object.entries(byDept)
            .sort((x, y) => y[1] - x[1])
            .map(([department, seats]) => ({ department, seats })),
          users: inactive.map((id) => {
            const p = index.identitiesById.get(id);
            const u = index.usageByIdentity.get(id)?.[0];
            return {
              name: p?.displayName ?? id,
              department: p?.departmentName ?? null,
              lastActivityAt: u?.lastActivityAt ?? null,
              accountEnabled: p?.accountEnabled ?? true,
            };
          }),
        },
        siteExternalId: null,
        departmentName: null,
        affectedCount: inactive.length,
        monthlyImpact: monthly,
        recommendation: {
          title: 'Reclaim or activate inactive seats',
          steps: [
            'Contact inactive users and their managers: offer a 30-minute onboarding session first.',
            'After 30 more days of inactivity, remove the licence and reassign it to a waitlisted power-user candidate.',
            'Move to group-based licensing with a "Copilot users" group owned by the business, reviewed monthly.',
          ],
          audience: ['IT', 'EXECUTIVE'],
          effort: 'low',
          impact: 'high',
        },
      },
    ];
  },
};
