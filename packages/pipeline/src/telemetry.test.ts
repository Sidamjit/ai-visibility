import { describe, expect, it, vi } from 'vitest';
import { runAnalysis } from '@aiv/analysis';
import { generateDemoBatch } from '@aiv/connectors';
import { NZ_PSR_SAMPLE_POLICY, PolicySchema } from '@aiv/policy';

vi.mock('./audit', () => ({ audit: vi.fn(async () => undefined) }));
const { bucket, buildTelemetryPayload, maybeSendTelemetry, telemetryEnabled } =
  await import('./telemetry');

const asOf = new Date('2026-11-14T00:00:00Z');
const result = runAnalysis(generateDemoBatch({ asOf }), {
  asOf,
  policy: PolicySchema.parse(NZ_PSR_SAMPLE_POLICY),
});

describe('telemetry (opt-in, anonymised counts)', () => {
  it('is off by default and needs both the flag and an endpoint', () => {
    expect(telemetryEnabled({})).toBe(false);
    expect(telemetryEnabled({ TELEMETRY_ENABLED: 'true' })).toBe(false);
    expect(telemetryEnabled({ TELEMETRY_ENDPOINT: 'https://t.example' })).toBe(false);
    expect(
      telemetryEnabled({ TELEMETRY_ENABLED: 'true', TELEMETRY_ENDPOINT: 'https://t.example' }),
    ).toBe(true);
  });

  it('never sends when disabled', async () => {
    const fetchImpl = vi.fn();
    const out = await maybeSendTelemetry('t1', result, {
      connectors: ['demo'],
      env: {},
      fetchImpl,
    });
    expect(out.sent).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('buckets sizes', () => {
    expect([0, 1, 9, 10, 99, 100, 2446].map(bucket)).toEqual([
      '0',
      '1-9',
      '1-9',
      '10-99',
      '10-99',
      '100-999',
      '1000-9999',
    ]);
  });

  it('contains no names, file details, findings text or tenant id', () => {
    const p = buildTelemetryPayload('tenant-secret-id', result, { connectors: ['demo'], env: {} });
    const text = JSON.stringify(p);
    expect(text).not.toContain('tenant-secret-id');
    expect(text).not.toMatch(/Harbourview|Payroll|Legal|@|\.docx|\.xlsx|overshared/i);
    for (const f of result.findings.slice(0, 50)) expect(text).not.toContain(f.title);
    expect(Object.keys(p).sort()).toEqual(
      [
        'appVersion',
        'buckets',
        'connectors',
        'findingsBySeverity',
        'install',
        'llmProvider',
        'rulesFired',
        'schema',
      ].sort(),
    );
  });
});
