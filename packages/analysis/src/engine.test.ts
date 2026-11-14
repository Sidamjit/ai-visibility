import { describe, expect, it } from 'vitest';
import { generateDemoBatch } from '@aiv/connectors';
import { runAnalysis } from './engine';
import { RULES } from './rules';
import { AS_OF } from './test-builders';

describe('runAnalysis on the demo organisation', () => {
  const messy = runAnalysis(generateDemoBatch({ asOf: AS_OF }), { asOf: AS_OF });
  const fixed = runAnalysis(generateDemoBatch({ asOf: AS_OF, remediationProgress: 1 }), {
    asOf: AS_OF,
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
      assumptions: { loadedHourlyCost: 110 },
    });
    expect(doubled.metrics.estimatedMonthlyValue).toBeCloseTo(
      messy.metrics.estimatedMonthlyValue * 2,
      -1,
    );
  });

  it('is deterministic', () => {
    expect(runAnalysis(generateDemoBatch({ asOf: AS_OF }), { asOf: AS_OF })).toEqual(messy);
  });
});
