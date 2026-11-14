/**
 * OPT-IN vendor telemetry. OFF unless TELEMETRY_ENABLED=true AND
 * TELEMETRY_ENDPOINT is set by the client. See docs/SECURITY.md → Telemetry.
 *
 * The payload is anonymised COUNTS only, bucketed so small organisations are
 * not identifiable: no tenant/site/file/person names, no findings text, no
 * classifier snippets, no IDs except a one-way install hash. Every send is
 * written to the audit log with the exact payload so the client can see what
 * left their environment.
 */
import { createHash } from 'node:crypto';
import type { AnalysisResult } from '@aiv/analysis';
import { audit } from './audit';

export const TELEMETRY_SCHEMA_VERSION = 1;

export interface TelemetryPayload {
  schema: number;
  install: string;
  appVersion: string;
  connectors: string[];
  llmProvider: string;
  buckets: {
    licensedUsers: string;
    filesScanned: string;
    classifiedFiles: string;
  };
  findingsBySeverity: Record<string, number>;
  rulesFired: string[];
}

/** Coarse size bucket: '0', '1-9', '10-99', '100-999', … */
export function bucket(n: number): string {
  if (n <= 0) return '0';
  const lo = 10 ** Math.floor(Math.log10(n));
  return lo === 1 ? '1-9' : `${lo}-${lo * 10 - 1}`;
}

export function telemetryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TELEMETRY_ENABLED?.trim().toLowerCase() === 'true' && !!env.TELEMETRY_ENDPOINT;
}

export function buildTelemetryPayload(
  tenantId: string,
  result: AnalysisResult,
  ctx: { connectors: string[]; env?: Record<string, string | undefined> },
): TelemetryPayload {
  const env = ctx.env ?? process.env;
  const findingsBySeverity: Record<string, number> = {};
  for (const f of result.findings)
    findingsBySeverity[f.severity] = (findingsBySeverity[f.severity] ?? 0) + 1;
  return {
    schema: TELEMETRY_SCHEMA_VERSION,
    install: createHash('sha256')
      .update(`${env.TELEMETRY_SALT ?? 'lumen'}:${tenantId}`)
      .digest('hex')
      .slice(0, 16),
    appVersion: env.APP_VERSION ?? '0.1.0',
    connectors: [...new Set(ctx.connectors)].sort(),
    llmProvider: (env.LLM_PROVIDER ?? 'none').toLowerCase(),
    buckets: {
      licensedUsers: bucket(result.metrics.licensedSeats),
      filesScanned: bucket(result.content?.filesScanned ?? 0),
      classifiedFiles: bucket(result.content?.classifiedFiles ?? 0),
    },
    findingsBySeverity,
    rulesFired: [...new Set(result.findings.map((f) => f.ruleId))].sort(),
  };
}

export async function maybeSendTelemetry(
  tenantId: string,
  result: AnalysisResult,
  ctx: { connectors: string[]; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch },
): Promise<{ sent: boolean; reason?: string }> {
  const env = ctx.env ?? process.env;
  if (!telemetryEnabled(env)) return { sent: false, reason: 'disabled' };
  const payload = buildTelemetryPayload(tenantId, result, ctx);
  try {
    const res = await (ctx.fetchImpl ?? fetch)(env.TELEMETRY_ENDPOINT!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    await audit({
      tenantId,
      actor: 'system',
      action: 'telemetry.send',
      target: new URL(env.TELEMETRY_ENDPOINT!).host,
      detail: { status: res.status, payload },
    });
    return { sent: res.ok, reason: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { sent: false, reason: (err as Error).message };
  }
}
