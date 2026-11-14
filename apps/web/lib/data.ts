/**
 * Tenant-scoped data access for pages. EVERY query takes `tenantId` from the
 * signed-in session — never from the URL — so one customer can never read
 * another's data. Prisma JSON columns are cast back to their analysis types.
 */
import type {
  DepartmentStat,
  OrgMetrics,
  Recommendation as RecShape,
  ScoreBreakdown,
  SiteScore,
} from '@aiv/analysis';
import type { Assumptions } from '@aiv/core';
import { prisma } from '@aiv/db';

export interface RunView {
  id: string;
  createdAt: Date;
  asOf: Date;
  riskScore: number;
  valueScore: number;
  scores: ScoreBreakdown;
  metrics: OrgMetrics;
  siteScores: SiteScore[];
  departments: DepartmentStat[];
  assumptions: Assumptions;
}

export interface FindingView {
  id: string;
  findingKey: string;
  ruleId: string;
  ruleName: string;
  kind: 'risk' | 'opportunity';
  category: string;
  severity: string;
  title: string;
  summary: string;
  evidence: Record<string, unknown>;
  siteExternalId: string | null;
  departmentName: string | null;
  affectedCount: number;
  monthlyImpact: number | null;
  recommendation: RecShape | null;
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

export async function getTenant(tenantId: string) {
  return prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
}

export async function getLatestRun(tenantId: string): Promise<RunView | null> {
  const run = await prisma.analysisRun.findFirst({
    where: { tenantId, simulated: false },
    orderBy: { createdAt: 'desc' },
  });
  if (!run) return null;
  return {
    id: run.id,
    createdAt: run.createdAt,
    asOf: run.asOf,
    riskScore: run.riskScore,
    valueScore: run.valueScore,
    scores: run.scores as unknown as ScoreBreakdown,
    metrics: run.metrics as unknown as OrgMetrics,
    siteScores: run.siteScores as unknown as SiteScore[],
    departments: run.departments as unknown as DepartmentStat[],
    assumptions: run.assumptions as unknown as Assumptions,
  };
}

/** Risk/value over time (one point per run; demo history is marked simulated). */
export async function getTrend(tenantId: string, limit = 26) {
  const runs = await prisma.analysisRun.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { createdAt: true, riskScore: true, valueScore: true, simulated: true, metrics: true },
  });
  return runs.reverse().map((r) => {
    const m = r.metrics as unknown as OrgMetrics;
    return {
      date: r.createdAt.toISOString(),
      risk: r.riskScore,
      value: r.valueScore,
      adoption: Math.round(m.adoptionRate * 100),
      spend: m.monthlySpend,
      estValue: m.estimatedMonthlyValue,
      simulated: r.simulated,
    };
  });
}

export async function getFindings(
  tenantId: string,
  runId: string,
  where: { siteExternalId?: string; departmentName?: string } = {},
): Promise<FindingView[]> {
  const rows = await prisma.finding.findMany({
    where: { tenantId, runId, ...where },
    include: { recommendation: true },
  });
  return rows
    .map((f) => ({
      id: f.id,
      findingKey: f.findingKey,
      ruleId: f.ruleId,
      ruleName: f.ruleName,
      kind: f.kind as 'risk' | 'opportunity',
      category: f.category,
      severity: f.severity,
      title: f.title,
      summary: f.summary,
      evidence: f.evidence as Record<string, unknown>,
      siteExternalId: f.siteExternalId,
      departmentName: f.departmentName,
      affectedCount: f.affectedCount,
      monthlyImpact: f.monthlyImpact,
      recommendation: f.recommendation
        ? {
            title: f.recommendation.title,
            steps: f.recommendation.steps as string[],
            audience: f.recommendation.audience as RecShape['audience'],
            effort: f.recommendation.effort as RecShape['effort'],
            impact: f.recommendation.impact as RecShape['impact'],
          }
        : null,
    }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
        b.affectedCount - a.affectedCount,
    );
}

/** Locations and grants of one site for the IT drill-down (metadata only). */
export async function getSiteDetail(tenantId: string, siteExternalId: string) {
  const [locations, labels] = await Promise.all([
    prisma.contentLocation.findMany({
      where: { tenantId, siteExternalId },
      orderBy: { name: 'asc' },
    }),
    prisma.sensitivityLabel.findMany({ where: { tenantId } }),
  ]);
  const grants = await prisma.sharingGrant.findMany({
    where: {
      tenantId,
      locationExternalId: { in: locations.map((l) => l.externalId) },
      inherited: false,
    },
  });
  return { locations, grants, labels: new Map(labels.map((l) => [l.externalId, l])) };
}

/** People in a department with their licence/usage status (manager view). */
export async function getDepartmentPeople(tenantId: string, department: string) {
  const people = await prisma.identity.findMany({
    where: { tenantId, departmentName: department, isGuest: false, accountEnabled: true },
    orderBy: { displayName: 'asc' },
  });
  const ids = people.map((p) => p.externalId);
  const [licences, usage] = await Promise.all([
    prisma.licence.findMany({ where: { tenantId, identityExternalId: { in: ids } } }),
    prisma.usageSummary.findMany({ where: { tenantId, identityExternalId: { in: ids } } }),
  ]);
  const licensed = new Set(licences.map((l) => l.identityExternalId));
  const usageBy = new Map(usage.map((u) => [u.identityExternalId, u]));
  return people.map((p) => {
    const u = usageBy.get(p.externalId);
    const features = (u?.featureLastActivity ?? {}) as Record<string, string | null>;
    return {
      id: p.externalId,
      name: p.displayName,
      jobTitle: p.jobTitle,
      licensed: licensed.has(p.externalId),
      lastActivityAt: u?.lastActivityAt ?? null,
      activeDays: u?.activeDays ?? null,
      apps: Object.entries(features)
        .filter(([, v]) => v)
        .map(([k]) => k),
    };
  });
}

export async function getRemediationState(tenantId: string) {
  const rows = await prisma.remediationTask.findMany({ where: { tenantId, done: true } });
  return new Set(rows.map((r) => `${r.findingKey}#${r.stepIndex}`));
}
