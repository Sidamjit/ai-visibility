/**
 * SPD-001 — AI spend vs adoption and value.
 */
import type { RuleDefinition } from '../types';
import { computeDepartmentStats, computeOrgMetrics } from '../metrics';
import { money, pctText } from './helpers';

export const spendVsAdoptionRule: RuleDefinition = {
  id: 'SPD-001',
  name: 'AI spend out of line with adoption',
  category: 'spend',
  kind: 'risk',
  description: 'Compares monthly AI spend with active users and estimated value.',
  rationale:
    'Executives need to know the effective cost per ACTIVE user and whether estimated value covers spend.',
  evaluate(ctx) {
    const a = ctx.assumptions;
    const m = computeOrgMetrics(ctx.data, ctx.index, a, computeDepartmentStats(ctx.index, a));
    if (m.monthlySpend === 0) return [];
    const perActive = m.activeSeats ? m.monthlySpend / m.activeSeats : m.monthlySpend;
    const roi = m.roi ?? 0;
    if (m.adoptionRate >= 0.7 && roi >= 1.5) return [];
    return [
      {
        ruleId: 'SPD-001',
        key: 'org',
        kind: 'risk',
        category: 'spend',
        severity: roi < 1 ? 'high' : m.adoptionRate < 0.5 ? 'medium' : 'low',
        title: `Effective cost ${money(perActive, a.currency)} per active user per month (adoption ${pctText(m.adoptionRate)})`,
        summary: `Spend ${money(m.monthlySpend, a.currency)}/month vs estimated value ${money(m.estimatedMonthlyValue, a.currency)}/month (ROI ${roi.toFixed(1)}x).`,
        evidence: {
          monthlySpend: m.monthlySpend,
          licenceSpend: m.licenceSpend,
          otherSpend: m.otherSpend,
          costItems: ctx.data.costs.map((c) => ({
            description: c.description,
            monthlyAmount: c.monthlyAmount,
          })),
          activeSeats: m.activeSeats,
          licensedSeats: m.licensedSeats,
          costPerActiveUser: Math.round(perActive),
          roi,
        },
        siteExternalId: null,
        departmentName: null,
        affectedCount: m.licensedSeats,
        monthlyImpact: m.wastedSpend,
        recommendation: {
          title: 'Tie AI spend to measured adoption',
          steps: [
            'Set a quarterly target for active-seat ratio (e.g. 70%) and cost per active user.',
            'Gate new licence purchases on the active ratio of existing seats.',
            'Review consumption-based AI costs (agents, Azure OpenAI) against their usage monthly.',
          ],
          audience: ['EXECUTIVE'],
          effort: 'low',
          impact: 'high',
        },
      },
    ];
  },
};
