/**
 * RDY-001 — Copilot readiness per site.
 *
 * Uses `siteReadiness()` from scoring.ts (single definition of the score) and
 * raises a finding for sites that are not safe for Copilot yet.
 */
import { siteReadiness } from '../scoring';
import type { RuleDefinition } from '../types';

export const copilotReadinessRule: RuleDefinition = {
  id: 'RDY-001',
  name: 'Site not ready for Copilot',
  category: 'readiness',
  kind: 'risk',
  description: 'Sites whose Copilot readiness score is below 60/100.',
  rationale:
    'Copilot inherits every permission problem. Sites scoring low should be remediated (or excluded with Restricted Content Discovery) before or alongside Copilot rollout to their audience.',
  evaluate(ctx) {
    return ctx.index.sites.flatMap((site) => {
      const s = siteReadiness(site, ctx);
      if (s.readiness >= 60) return [];
      return [
        {
          ruleId: 'RDY-001',
          key: site.externalId,
          kind: 'risk' as const,
          category: 'readiness' as const,
          severity: s.readiness < 30 ? ('high' as const) : ('medium' as const),
          title: `"${site.name}" Copilot readiness ${s.readiness}/100`,
          summary: s.deductions.slice(0, 3).join('; '),
          evidence: { readiness: s.readiness, deductions: s.deductions },
          siteExternalId: site.externalId,
          departmentName: site.ownerDepartment,
          affectedCount: 1,
          monthlyImpact: null,
          recommendation: {
            title: 'Bring the site to Copilot-ready',
            steps: [
              'Fix the oversharing findings for this site (see related OVR/LAB findings).',
              'Until fixed, enable Restricted Content Discovery for this site.',
              'Re-run the analysis to confirm the score is 60+.',
            ],
            audience: ['IT'],
            effort: 'medium',
            impact: 'high',
          },
        },
      ];
    });
  },
};
