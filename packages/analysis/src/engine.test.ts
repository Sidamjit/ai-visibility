import { describe, expect, it } from 'vitest';
import { generateDemoBatch } from '@aiv/connectors';
import { NZ_PSR_SAMPLE_POLICY, PolicySchema } from '@aiv/policy';
import { runAnalysis } from './engine';
import { RULES } from './rules';
import { AS_OF } from './test-builders';

describe('runAnalysis on the demo organisation', () => {
  const policy = PolicySchema.parse(NZ_PSR_SAMPLE_POLICY);
  const messy = runAnalysis(generateDemoBatch({ asOf: AS_OF }), { asOf: AS_OF, policy });
  const fixed = runAnalysis(generateDemoBatch({ asOf: AS_OF, remediationProgress: 1 }), {
    asOf: AS_OF,
    policy,
  });

  it('exercises every rule', () => {
    const fired = new Set(messy.findings.map((f) => f.ruleId));
    for (const r of RULES) expect(fired, r.id).toContain(r.id);
  });

  it('produces bounded scores and sorted findings', () => {
    for (const s of [messy.scores.riskScore, messy.scores.valueScore]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
    expect(messy.findings[0]?.severity).toBe('critical');
    expect(new Set(messy.findings.map((f) => f.id)).size).toBe(messy.findings.length);
  });

  it('remediation lowers risk and raises value', () => {
    expect(fixed.scores.riskScore).toBeLessThan(messy.scores.riskScore);
    expect(fixed.scores.valueScore).toBeGreaterThan(messy.scores.valueScore);
  });

  it('uses editable assumptions for money', () => {
    const doubled = runAnalysis(generateDemoBatch({ asOf: AS_OF }), {
      asOf: AS_OF,
      policy,
      assumptions: { loadedHourlyCost: 110 },
    });
    expect(doubled.metrics.estimatedMonthlyValue).toBeCloseTo(
      messy.metrics.estimatedMonthlyValue * 2,
      -1,
    );
  });

  it('is deterministic', () => {
    expect(runAnalysis(generateDemoBatch({ asOf: AS_OF }), { asOf: AS_OF, policy })).toEqual(messy);
  });

  it('summarises content scanning and classified files (content-free)', () => {
    expect(messy.content).not.toBeNull();
    expect(messy.content!.filesScanned).toBeGreaterThan(1000);
    expect(messy.content!.breachingFiles).toBeGreaterThan(5);
    expect(messy.contentFiles.length).toBeGreaterThan(10);
    expect(messy.contentFiles[0]!.levelId).toBe('RESTRICTED');
    expect(messy.scores.riskComponents).toHaveProperty('policy');
    expect(fixed.content!.breachingFiles).toBeLessThan(messy.content!.breachingFiles);
  });

  it('runs without a policy (metadata-only rules)', () => {
    const r = runAnalysis(generateDemoBatch({ asOf: AS_OF }), { asOf: AS_OF });
    expect(r.content).toBeNull();
    expect(r.findings.some((f) => f.category === 'policy')).toBe(false);
  });
});
