/**
 * Types shared by the analysis engine and its rules.
 *
 * A RULE is a pure function from `RuleContext` (indexed, normalized data +
 * assumptions) to zero or more `FindingDraft`s. The engine assigns IDs, sorts,
 * and computes scores. Rules never do I/O and never read the clock directly
 * (use `ctx.asOf`), so every rule is deterministic and unit-testable.
 */
import type { Assumptions, NormalizedBatch, Role } from '@aiv/core';
import type { AnalysisIndex } from './context';

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 10,
  high: 5,
  medium: 2,
  low: 1,
  info: 0,
};

export const CATEGORIES = [
  'oversharing',
  'labelling',
  'identity',
  'readiness',
  'licensing',
  'adoption',
  'capability',
  'spend',
  'value',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** 'risk' = something bad to reduce; 'opportunity' = value to unlock. */
export type FindingKind = 'risk' | 'opportunity';

export interface Recommendation {
  title: string;
  /** Ordered, concrete remediation steps (checklist items in the IT dashboard). */
  steps: string[];
  /** Who should act. Drives which dashboards show it. */
  audience: Role[];
  effort: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
}

/** What a rule returns. The engine adds `id` and `ruleName`. */
export interface FindingDraft {
  ruleId: string;
  /** Stable key within the rule (e.g. site ID) so findings can be tracked across runs. */
  key: string;
  kind: FindingKind;
  category: Category;
  severity: Severity;
  title: string;
  summary: string;
  /** Structured, metadata-only proof. Rendered as a table/JSON in the UI. */
  evidence: Record<string, unknown>;
  siteExternalId: string | null;
  departmentName: string | null;
  affectedCount: number;
  /** Money that fixing this would save/unlock per month (in assumptions.currency). */
  monthlyImpact: number | null;
  recommendation: Recommendation;
}

export interface Finding extends FindingDraft {
  /** `${ruleId}:${key}` — stable across runs. */
  id: string;
  ruleName: string;
}

export interface RuleContext {
  data: NormalizedBatch;
  index: AnalysisIndex;
  assumptions: Assumptions;
  asOf: Date;
}

/**
 * The contract every rule file implements. See docs/ADDING_AN_ANALYSIS_RULE.md.
 */
export interface RuleDefinition {
  /** Stable ID like 'OVR-001'. Prefix = area. Never reuse an ID. */
  id: string;
  name: string;
  category: Category;
  kind: FindingKind;
  /** What the rule detects, for the UI rule catalogue. */
  description: string;
  /** Why it matters (business + security rationale). */
  rationale: string;
  evaluate(ctx: RuleContext): FindingDraft[];
}

export interface SiteScore {
  siteExternalId: string;
  name: string;
  department: string | null;
  webUrl: string | null;
  /** 0-100, higher = safer for Copilot to reason over. */
  readiness: number;
  /** Plain-English reasons for deductions. */
  deductions: string[];
  sensitiveItems: number;
  anyoneLinks: number;
  orgLinks: number;
  externalGrants: number;
  uniquePermissionItems: number;
  memberCount: number | null;
  visibility: string;
  stale: boolean;
}

export interface DepartmentStat {
  name: string;
  headcount: number;
  licensed: number;
  active: number;
  adoptionRate: number;
  avgBreadth: number;
  /** app -> number of licensed users who used it in the period. */
  featureUsers: Record<string, number>;
  estimatedHoursSavedPerMonth: number;
}

export interface OrgMetrics {
  totalUsers: number;
  guestUsers: number;
  licensedSeats: number;
  activeSeats: number;
  inactiveSeats: number;
  adoptionRate: number;
  avgFeatureBreadth: number;
  monthlySpend: number;
  licenceSpend: number;
  otherSpend: number;
  wastedSpend: number;
  estimatedHoursSavedPerMonth: number;
  estimatedMonthlyValue: number;
  /** estimatedMonthlyValue / monthlySpend (null if no spend). */
  roi: number | null;
  sites: number;
  publicSites: number;
  sensitiveLocations: number;
  unlabeledSensitive: number;
  anyoneLinks: number;
  orgLinks: number;
  externalGrants: number;
  uniquePermissionItems: number;
  staleSites: number;
  currency: string;
}

export interface ScoreBreakdown {
  /** 0-100, higher = MORE risk. */
  riskScore: number;
  /** 0-100, higher = MORE value realised. */
  valueScore: number;
  riskComponents: Record<string, number>;
  valueComponents: Record<string, number>;
}

export interface AnalysisResult {
  asOf: string;
  findings: Finding[];
  scores: ScoreBreakdown;
  metrics: OrgMetrics;
  siteScores: SiteScore[];
  departments: DepartmentStat[];
  assumptions: Assumptions;
}
