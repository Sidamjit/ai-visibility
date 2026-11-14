/**
 * Run the analysis engine for a tenant and persist the AnalysisRun with its
 * findings, recommendations and value metrics.
 */
import { runAnalysis, type AnalysisResult } from '@aiv/analysis';
import {
  AssumptionsSchema,
  DEFAULT_ASSUMPTIONS,
  type Assumptions,
  type NormalizedBatch,
} from '@aiv/core';
import { loadBatch, prisma, type Prisma } from '@aiv/db';
import type { Policy } from '@aiv/policy';
import { getTenantPolicy } from './policy';
import { maybeSendTelemetry } from './telemetry';

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Tenant assumptions merged over defaults (invalid stored values fall back to defaults). */
export async function getTenantAssumptions(tenantId: string): Promise<Assumptions> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const parsed = AssumptionsSchema.safeParse({
    ...DEFAULT_ASSUMPTIONS,
    ...((tenant.assumptions as object | null) ?? {}),
  });
  return parsed.success ? parsed.data : DEFAULT_ASSUMPTIONS;
}

export async function saveAnalysisRun(
  tenantId: string,
  result: AnalysisResult,
  opts: { simulated?: boolean; createdAt?: Date } = {},
): Promise<string> {
  const run = await prisma.analysisRun.create({
    data: {
      tenantId,
      createdAt: opts.createdAt ?? new Date(),
      asOf: new Date(result.asOf),
      riskScore: result.scores.riskScore,
      valueScore: result.scores.valueScore,
      scores: json(result.scores),
      metrics: json(result.metrics),
      siteScores: json(result.siteScores),
      departments: json(result.departments),
      assumptions: json(result.assumptions),
      content: result.content ? json(result.content) : undefined,
      contentFiles: opts.simulated ? undefined : json(result.contentFiles),
      simulated: opts.simulated ?? false,
    },
  });
  // Simulated history only needs scores/metrics for trend charts.
  if (opts.simulated) return run.id;

  for (const f of result.findings) {
    await prisma.finding.create({
      data: {
        runId: run.id,
        tenantId,
        findingKey: f.id,
        ruleId: f.ruleId,
        ruleName: f.ruleName,
        kind: f.kind,
        category: f.category,
        severity: f.severity,
        title: f.title,
        summary: f.summary,
        evidence: json(f.evidence),
        siteExternalId: f.siteExternalId,
        departmentName: f.departmentName,
        affectedCount: f.affectedCount,
        monthlyImpact: f.monthlyImpact,
        recommendation: {
          create: {
            runId: run.id,
            tenantId,
            title: f.recommendation.title,
            steps: json(f.recommendation.steps),
            audience: json(f.recommendation.audience),
            effort: f.recommendation.effort,
            impact: f.recommendation.impact,
          },
        },
      },
    });
  }

  const m = result.metrics;
  const a = result.assumptions;
  await prisma.valueMetric.createMany({
    data: [
      {
        key: 'hoursSavedPerMonth',
        label: 'Estimated hours saved per month',
        value: m.estimatedHoursSavedPerMonth,
        unit: 'hours',
        assumptionKeys: [
          'hoursSavedPerWeekLightUser',
          'hoursSavedPerWeekRegularUser',
          'hoursSavedPerWeekPowerUser',
        ],
      },
      {
        key: 'monthlyValue',
        label: 'Estimated value per month',
        value: m.estimatedMonthlyValue,
        unit: a.currency,
        assumptionKeys: ['loadedHourlyCost', 'valueConfidenceFactor'],
      },
      {
        key: 'monthlySpend',
        label: 'AI spend per month',
        value: m.monthlySpend,
        unit: a.currency,
        assumptionKeys: ['copilotSeatMonthlyCost'],
      },
      {
        key: 'roi',
        label: 'Estimated value ÷ spend',
        value: m.roi ?? 0,
        unit: 'x',
        assumptionKeys: ['copilotSeatMonthlyCost', 'loadedHourlyCost', 'valueConfidenceFactor'],
      },
      {
        key: 'wastedSpend',
        label: 'Spend on inactive seats per month',
        value: m.wastedSpend,
        unit: a.currency,
        assumptionKeys: ['inactiveSeatDays', 'copilotSeatMonthlyCost'],
      },
    ].map((v) => ({ ...v, runId: run.id, tenantId, assumptionKeys: json(v.assumptionKeys) })),
  });
  return run.id;
}

/** Load tenant data (or use a provided batch), run analysis, persist. */
export async function runTenantAnalysis(
  tenantId: string,
  opts: {
    batch?: NormalizedBatch;
    asOf?: Date;
    simulated?: boolean;
    createdAt?: Date;
    policy?: Policy;
  } = {},
): Promise<{ runId: string; result: AnalysisResult }> {
  const batch = opts.batch ?? (await loadBatch(prisma, tenantId));
  const assumptions = await getTenantAssumptions(tenantId);
  const policy = opts.policy ?? (await getTenantPolicy(tenantId)).policy;
  const result = runAnalysis(batch, { assumptions, asOf: opts.asOf, policy });
  const runId = await saveAnalysisRun(tenantId, result, {
    simulated: opts.simulated,
    createdAt: opts.createdAt,
  });
  if (!opts.simulated) {
    const instances = await prisma.connectorInstance.findMany({ where: { tenantId } });
    await maybeSendTelemetry(tenantId, result, {
      connectors: instances.map((i) => i.connectorId),
    });
  }
  return { runId, result };
}
