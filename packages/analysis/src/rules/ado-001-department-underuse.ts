/**
 * ADO-001 — Departments under-using the AI they have been given.
 */
import { computeDepartmentStats } from '../metrics';
import type { RuleDefinition } from '../types';
import { money, pctText } from './helpers';

export const departmentUnderuseRule: RuleDefinition = {
  id: 'ADO-001',
  name: 'Department under-using AI',
  category: 'adoption',
  kind: 'opportunity',
  description: 'Departments where the share of active licensed users is below the adoption target.',
  rationale:
    'Low adoption usually means unclear use cases, not unwilling people. Targeted enablement in the lowest departments gives the fastest return on licences already paid for.',
  evaluate(ctx) {
    const a = ctx.assumptions;
    return computeDepartmentStats(ctx.index, a)
      .filter((d) => d.licensed >= 3 && d.adoptionRate < a.departmentAdoptionTarget)
      .map((d) => {
        const gapUsers = Math.ceil(d.licensed * a.departmentAdoptionTarget) - d.active;
        return {
          ruleId: 'ADO-001',
          key: d.name,
          kind: 'opportunity' as const,
          category: 'adoption' as const,
          severity:
            d.adoptionRate < a.departmentAdoptionTarget / 2
              ? ('high' as const)
              : ('medium' as const),
          title: `${d.name}: ${pctText(d.adoptionRate)} of licensed users active (target ${pctText(a.departmentAdoptionTarget)})`,
          summary: `${d.active}/${d.licensed} active. Reaching target means ${gapUsers} more active users.`,
          evidence: { ...d },
          siteExternalId: null,
          departmentName: d.name,
          affectedCount: d.licensed - d.active,
          monthlyImpact: gapUsers * a.copilotSeatMonthlyCost,
          recommendation: {
            title: `Run an adoption sprint in ${d.name}`,
            steps: [
              `Nominate 1-2 Copilot champions in ${d.name} from its most active users.`,
              'Run a 45-minute workshop on 3 role-specific scenarios (e.g. meeting recap, drafting, data summary).',
              'Share a prompt library for the team and review usage again in 30 days.',
              `If adoption is still low, reassign seats (each idle seat costs ${money(a.copilotSeatMonthlyCost, a.currency)}/month).`,
            ],
            audience: ['MANAGER', 'EXECUTIVE'],
            effort: 'low',
            impact: 'high',
          },
        };
      });
  },
};
