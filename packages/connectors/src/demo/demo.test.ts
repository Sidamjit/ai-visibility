import { describe, expect, it } from 'vitest';
import { NormalizedBatchSchema } from '@aiv/core';
import { generateDemoBatch } from './generate';

describe('demo generator', () => {
  const asOf = new Date('2026-11-14T00:00:00Z');
  it('is deterministic and schema-valid', () => {
    const a = generateDemoBatch({ seed: 1, asOf });
    const b = generateDemoBatch({ seed: 1, asOf });
    expect(a).toEqual(b);
    expect(() => NormalizedBatchSchema.parse(a)).not.toThrow();
    expect(a.identities.length).toBeGreaterThan(400);
  });
  it('remediation reduces anyone links', () => {
    const before = generateDemoBatch({ seed: 1, asOf }).grants.filter(
      (g) => g.scope === 'anyone',
    ).length;
    const after = generateDemoBatch({ seed: 1, asOf, remediationProgress: 1 }).grants.filter(
      (g) => g.scope === 'anyone',
    ).length;
    expect(after).toBeLessThan(before);
    expect(after).toBe(0);
  });
});
