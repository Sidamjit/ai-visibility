/**
 * CAP-001 — Capability gaps: active users who only use AI in one or two apps.
 */
import { computeDepartmentStats } from '../metrics';
import type { RuleDefinition } from '../types';
import { pctText } from './helpers';

/** Suggested training module per Copilot surface. Shown on the manager dashboard. */
export const TRAINING_BY_FEATURE: Record<string, string> = {
  teams: 'Copilot in Teams: meeting recaps, action items and catch-up on missed chats',
  outlook: 'Copilot in Outlook: inbox triage, thread summaries and drafting replies',
  word: 'Copilot in Word: first drafts from existing files, rewriting and summarising',
  excel: 'Copilot in Excel: formulas, analysis and charts in plain language',
  powerpoint: 'Copilot in PowerPoint: build decks from a document, restyle and summarise',
  chat: 'Microsoft 365 Copilot Chat: grounded Q&A over your work content, prompt patterns',
  loop: 'Copilot in Loop: co-creating plans and briefs with the team',
  onenote: 'Copilot in OneNote: organising notes and generating to-do lists',
};

export const capabilityGapsRule: RuleDefinition = {
  id: 'CAP-001',
  name: 'Capability gaps (low feature breadth)',
  category: 'capability',
  kind: 'opportunity',
  description:
    'Departments whose active users use AI in only a few apps, with the apps they are missing.',
  rationale:
    'Most measured Copilot value comes from using it across the daily workflow (meetings, email, documents, data). Users stuck in one app get a fraction of the value of the same licence.',
  evaluate(ctx) {
    const threshold = ctx.assumptions.lowFeatureBreadthThreshold;
    return computeDepartmentStats(ctx.index, ctx.assumptions)
      .filter((d) => d.active >= 2 && d.avgBreadth <= threshold + 0.5)
      .map((d) => {
        const missing = Object.keys(TRAINING_BY_FEATURE)
          .map((f) => ({ feature: f, users: d.featureUsers[f] ?? 0 }))
          .sort((x, y) => x.users - y.users)
          .slice(0, 3);
        return {
          ruleId: 'CAP-001',
          key: d.name,
          kind: 'opportunity' as const,
          category: 'capability' as const,
          severity: d.avgBreadth <= threshold ? ('medium' as const) : ('low' as const),
          title: `${d.name}: active users use Copilot in ${d.avgBreadth.toFixed(1)} apps on average`,
          summary: `Least-used: ${missing.map((m) => m.feature).join(', ')}. Adoption ${pctText(d.adoptionRate)}.`,
          evidence: { avgBreadth: d.avgBreadth, featureUsers: d.featureUsers, leastUsed: missing },
          siteExternalId: null,
          departmentName: d.name,
          affectedCount: d.active,
          monthlyImpact: null,
          recommendation: {
            title: `Broaden ${d.name}'s Copilot skills`,
            steps: missing
              .map((m) => `Training: ${TRAINING_BY_FEATURE[m.feature] ?? m.feature}`)
              .concat(['Ask champions to demo one real team workflow per week for a month.']),
            audience: ['MANAGER'],
            effort: 'low',
            impact: 'medium',
          },
        };
      });
  },
};
