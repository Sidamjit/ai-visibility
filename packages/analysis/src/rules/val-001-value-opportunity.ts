/**
 * VAL-001 — Estimated value realised and value still on the table.
 *
 * Uses the transparent value model in metrics.ts (editable assumptions).
 */
import type { RuleDefinition } from '../types';
import { computeDepartmentStats, computeOrgMetrics, hoursPerMonthFor } from '../metrics';
import { money } from './helpers';

export const valueOpportunityRule: RuleDefinition = {
  id: 'VAL-001',
  name: 'Value uplift available from existing licences',
  category: 'value',
  kind: 'opportunity',
  description:
    'Estimates hours/money saved today and the uplift if inactive and light users became regular users.',
  rationale:
    "Shows leadership the upside of fixing adoption, using the organisation's own editable assumptions rather than vendor marketing numbers.",
  evaluate(ctx) {
    const a = ctx.assumptions;
    const m = computeOrgMetrics(ctx.data, ctx.index, a, computeDepartmentStats(ctx.index, a));
    const regularHours = hoursPerMonthFor('regular', a);
    let upliftHours = 0;
    for (const id of ctx.index.licencesByIdentity.keys()) {
      const intensity = ctx.index.intensity(ctx.index.usageByIdentity.get(id)?.[0]);
      if (intensity === 'none' || intensity === 'light')
        upliftHours += regularHours - hoursPerMonthFor(intensity, a);
    }
    const upliftValue = Math.round(upliftHours * a.loadedHourlyCost * a.valueConfidenceFactor);
    if (upliftValue <= 0) return [];
    return [
      {
        ruleId: 'VAL-001',
        key: 'org',
        kind: 'opportunity',
        category: 'value',
        severity: 'info',
        title: `${money(upliftValue, a.currency)}/month additional value available from existing seats`,
        summary: `Today: ~${m.estimatedHoursSavedPerMonth} hours/month saved (${money(m.estimatedMonthlyValue, a.currency)}). Moving inactive and light users to regular use adds ~${Math.round(upliftHours)} hours/month.`,
        evidence: {
          hoursSavedPerMonth: m.estimatedHoursSavedPerMonth,
          monthlyValue: m.estimatedMonthlyValue,
          upliftHours: Math.round(upliftHours),
          upliftValue,
          assumptions: {
            loadedHourlyCost: a.loadedHourlyCost,
            confidence: a.valueConfidenceFactor,
            hoursPerWeek: {
              light: a.hoursSavedPerWeekLightUser,
              regular: a.hoursSavedPerWeekRegularUser,
              power: a.hoursSavedPerWeekPowerUser,
            },
          },
        },
        siteExternalId: null,
        departmentName: null,
        affectedCount: m.licensedSeats,
        monthlyImpact: upliftValue,
        recommendation: {
          title: 'Fund an enablement programme from the uplift',
          steps: [
            'Prioritise departments flagged by ADO-001 and CAP-001.',
            'Measure the same metrics monthly in this dashboard to confirm uplift.',
            'Validate the hours-saved assumptions with a short user survey and update them in Settings.',
          ],
          audience: ['EXECUTIVE', 'MANAGER'],
          effort: 'medium',
          impact: 'high',
        },
      },
    ];
  },
};
