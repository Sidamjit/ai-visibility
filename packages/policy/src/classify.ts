/**
 * Content classification: turns classifier hits for one file into a policy
 * classification level, using the policy's `contentRules`.
 *
 * The highest-ranked level among matching rules wins. A client-hosted LLM
 * assessment (optional) can RAISE the level, never lower it, so the
 * deterministic rules stay the floor.
 */
import type { ClassifierHit, Confidence, LlmAssessment } from '@aiv/core';
import type { Policy, PolicyLevel } from './schema';

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export interface MatchedContentRule {
  ruleId: string;
  description: string;
  levelId: string;
  /** Classifiers that satisfied the rule, with their counts. */
  classifiers: Array<{ classifierId: string; count: number; distinctValues: number }>;
}

export interface ClassificationResult {
  level: PolicyLevel;
  /** Rules that matched (all of them, not only the winning one), highest level first. */
  matchedRules: MatchedContentRule[];
  /** How the level was decided. */
  source: 'content-rules' | 'llm' | 'default';
}

/** Look up a level by id (throws for unknown ids; policies are validated on save). */
export function levelById(policy: Policy, id: string): PolicyLevel {
  const level = policy.levels.find((l) => l.id === id);
  if (!level) throw new Error(`Unknown classification level "${id}"`);
  return level;
}

/** Levels sorted from least to most sensitive. */
export function levelsByRank(policy: Policy): PolicyLevel[] {
  return [...policy.levels].sort((a, b) => a.rank - b.rank);
}

/** Classify one scanned file. */
export function classifyScan(
  policy: Policy,
  hits: readonly ClassifierHit[],
  llm: LlmAssessment | null = null,
): ClassificationResult {
  const byId = new Map(hits.map((h) => [h.classifierId, h]));
  const matched: MatchedContentRule[] = [];
  for (const rule of policy.contentRules) {
    const satisfied = rule.classifiers
      .map((id) => byId.get(id))
      .filter(
        (h): h is ClassifierHit =>
          h !== undefined &&
          h.count >= rule.minCount &&
          h.distinctValues >= rule.minDistinct &&
          CONFIDENCE_RANK[h.confidence] >= CONFIDENCE_RANK[rule.minConfidence],
      );
    if (satisfied.length) {
      matched.push({
        ruleId: rule.id,
        description: rule.description,
        levelId: rule.level,
        classifiers: satisfied.map((h) => ({
          classifierId: h.classifierId,
          count: h.count,
          distinctValues: h.distinctValues,
        })),
      });
    }
  }
  matched.sort((a, b) => levelById(policy, b.levelId).rank - levelById(policy, a.levelId).rank);

  let level = levelById(policy, policy.defaultLevel);
  let source: ClassificationResult['source'] = 'default';
  const top = matched[0];
  if (top) {
    level = levelById(policy, top.levelId);
    source = 'content-rules';
  }
  const llmLevel = llm?.levelId ? policy.levels.find((l) => l.id === llm.levelId) : undefined;
  if (llmLevel && llm && llm.confidence >= 0.7 && llmLevel.rank > level.rank) {
    level = llmLevel;
    source = 'llm';
  }
  return { level, matchedRules: matched, source };
}
