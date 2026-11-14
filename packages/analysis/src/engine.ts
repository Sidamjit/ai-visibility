/**
 * Analysis engine: runs every rule over normalized data and produces the full
 * AnalysisResult (findings, scores, metrics, site and department rollups).
 *
 * Pure and deterministic: same input -> same output. The worker persists the
 * result; the web app only reads it.
 */
import {
  AssumptionsSchema,
  DEFAULT_ASSUMPTIONS,
  type Assumptions,
  type NormalizedBatch,
} from '@aiv/core';
import type { Policy } from '@aiv/policy';
import { toFileViews } from './content';
import { buildIndex } from './context';
import { computeDepartmentStats, computeOrgMetrics } from './metrics';
import { RULES } from './rules';
import { computeScores, siteReadiness } from './scoring';
import {
  SEVERITY_WEIGHT,
  type AnalysisResult,
  type Finding,
  type RuleContext,
  type RuleDefinition,
} from './types';

export interface RunAnalysisOptions {
  assumptions?: Partial<Assumptions>;
  asOf?: Date;
  /** Tenant data-classification policy; enables POL-xxx rules and content metrics. */
  policy?: Policy | null;
  /** Override the rule set (tests, or tenant-specific rule packs). */
  rules?: readonly RuleDefinition[];
}

export function runAnalysis(data: NormalizedBatch, opts: RunAnalysisOptions = {}): AnalysisResult {
  const assumptions = AssumptionsSchema.parse({ ...DEFAULT_ASSUMPTIONS, ...opts.assumptions });
  const asOf = opts.asOf ?? new Date();
  const policy = opts.policy ?? null;
  const index = buildIndex(data, assumptions, asOf, policy);
  const ctx: RuleContext = { data, index, assumptions, policy, asOf };

  const findings: Finding[] = [];
  for (const rule of opts.rules ?? RULES) {
    for (const draft of rule.evaluate(ctx)) {
      findings.push({ ...draft, id: `${draft.ruleId}:${draft.key}`, ruleName: rule.name });
    }
  }
  // Most severe first; within a severity, most affected first.
  findings.sort(
    (x, y) =>
      SEVERITY_WEIGHT[y.severity] - SEVERITY_WEIGHT[x.severity] ||
      y.affectedCount - x.affectedCount,
  );

  const siteScores = index.sites
    .map((s) => siteReadiness(s, ctx))
    .sort((x, y) => x.readiness - y.readiness);
  const departments = computeDepartmentStats(index, assumptions);
  const metrics = computeOrgMetrics(data, index, assumptions, departments);
  const scores = computeScores(ctx, metrics, siteScores, findings);

  return {
    asOf: asOf.toISOString(),
    findings,
    scores,
    metrics,
    siteScores,
    departments,
    assumptions,
    content: index.content?.metrics ?? null,
    contentFiles: index.content ? toFileViews(index.content) : [],
  };
}
