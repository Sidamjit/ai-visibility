/**
 * Tenant policy + scan settings: load (with safe defaults), save from the
 * editor/CLI, and draft from an uploaded policy document.
 */
import { createHash } from 'node:crypto';
import { DEFAULT_SCAN_SETTINGS, ScanSettingsSchema, type ScanSettings } from '@aiv/core';
import {
  BUILTIN_CLASSIFIER_IDS,
  createLlmClientFromEnv,
  extractText,
  extensionOf,
  ExtractionError,
} from '@aiv/content-scan';
import {
  NZ_PSR_SAMPLE_POLICY,
  PolicySchema,
  buildPolicyDraftPrompt,
  draftPolicyHeuristically,
  parseLlmPolicyDraft,
  parsePolicy,
  type Policy,
  type PolicyDraftResult,
} from '@aiv/policy';
import { prisma, Prisma } from '@aiv/db';
import { audit } from './audit';

const json = (v: unknown) => v as Prisma.InputJsonValue;

export interface TenantPolicy {
  policy: Policy;
  /** 'tenant' = the client's own; 'sample' = NZ sample used because none is set. */
  source: 'tenant' | 'sample';
  updatedAt: Date | null;
  updatedBy: string | null;
}

export async function getTenantPolicy(tenantId: string): Promise<TenantPolicy> {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (t.policy) {
    const parsed = PolicySchema.safeParse(t.policy);
    if (parsed.success)
      return {
        policy: parsed.data,
        source: 'tenant',
        updatedAt: t.policyUpdatedAt,
        updatedBy: t.policyUpdatedBy,
      };
    console.warn(`[policy] stored policy for tenant ${tenantId} is invalid; using the sample.`);
  }
  return {
    policy: PolicySchema.parse(NZ_PSR_SAMPLE_POLICY),
    source: 'sample',
    updatedAt: null,
    updatedBy: null,
  };
}

export async function getScanSettings(tenantId: string): Promise<ScanSettings> {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const parsed = ScanSettingsSchema.safeParse(t.scanSettings ?? {});
  return parsed.success ? parsed.data : DEFAULT_SCAN_SETTINGS;
}

export async function saveScanSettings(
  tenantId: string,
  input: unknown,
  actor: { email: string; role?: string },
): Promise<{ ok: true; settings: ScanSettings } | { ok: false; errors: string[] }> {
  const parsed = ScanSettingsSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { scanSettings: json(parsed.data) },
  });
  await audit({
    tenantId,
    actor: actor.email,
    actorRole: actor.role,
    action: 'settings.scanning.update',
    target: 'scanSettings',
    detail: { ...parsed.data, allowedExtensions: parsed.data.allowedExtensions.length },
  });
  return { ok: true, settings: parsed.data };
}

/** Validate + store a policy from YAML/JSON text. */
export async function saveTenantPolicy(
  tenantId: string,
  text: string,
  actor: { email: string; role?: string },
): Promise<{ ok: true; policy: Policy; warnings: string[] } | { ok: false; errors: string[] }> {
  const result = parsePolicy(text, BUILTIN_CLASSIFIER_IDS);
  if (!result.ok) return result;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      policy: json(result.policy),
      policyUpdatedAt: new Date(),
      policyUpdatedBy: actor.email,
    },
  });
  await audit({
    tenantId,
    actor: actor.email,
    actorRole: actor.role,
    action: 'policy.update',
    target: `${result.policy.name} v${result.policy.version}`,
    detail: { levels: result.policy.levels.length, rules: result.policy.contentRules.length },
  });
  return result;
}

/** Remove the tenant policy (the NZ sample applies again). */
export async function resetTenantPolicy(tenantId: string, actor: { email: string; role?: string }) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { policy: Prisma.DbNull, policyUpdatedAt: new Date(), policyUpdatedBy: actor.email },
  });
  await audit({ tenantId, actor: actor.email, actorRole: actor.role, action: 'policy.reset' });
}

/**
 * Turn an uploaded policy DOCUMENT (docx/pdf/txt/md…) into a draft policy for
 * human review. The document is processed in memory and not stored — only its
 * name and SHA-256 are kept with the draft. Uses the client's own LLM endpoint
 * if configured (LLM_PROVIDER), otherwise the heuristic extractor.
 */
export async function draftPolicyFromDocument(
  tenantId: string,
  file: { name: string; bytes: Uint8Array },
  actor: { email: string; role?: string },
  env: Record<string, string | undefined> = process.env,
): Promise<
  { ok: true; draftId: string; result: PolicyDraftResult } | { ok: false; error: string }
> {
  if (file.bytes.byteLength > 20 * 1024 * 1024)
    return { ok: false, error: 'Policy document is larger than 20 MB.' };
  const sha = createHash('sha256').update(file.bytes).digest('hex');
  let text: string;
  try {
    text = (await extractText(file.bytes, extensionOf(file.name), { maxChars: 400_000 })).text;
  } catch (err) {
    const msg =
      err instanceof ExtractionError
        ? `Could not read the document (${err.reason}).`
        : `Could not read the document: ${(err as Error).message}`;
    return { ok: false, error: msg };
  } finally {
    file.bytes.fill(0);
  }
  if (text.trim().length < 50)
    return { ok: false, error: 'The document contains no readable text.' };

  let result: PolicyDraftResult = draftPolicyHeuristically(text, file.name);
  const llm = createLlmClientFromEnv(env);
  if (llm) {
    try {
      const prompt = buildPolicyDraftPrompt(text);
      const answer = await llm.complete(
        [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        { maxTokens: 4000, json: true },
      );
      const parsed = parseLlmPolicyDraft(answer, file.name);
      if ('error' in parsed)
        result = { ...result, notes: [`LLM draft rejected: ${parsed.error}`, ...result.notes] };
      else
        result = {
          ...parsed,
          notes: [...parsed.notes, `Model: ${llm.model} at ${llm.endpointHost} (client-hosted).`],
        };
    } catch (err) {
      result = {
        ...result,
        notes: [
          `LLM unavailable (${(err as Error).message}); heuristic draft shown.`,
          ...result.notes,
        ],
      };
    }
  }
  text = '';
  const draft = await prisma.policyDraft.create({
    data: {
      tenantId,
      createdBy: actor.email,
      sourceName: file.name.slice(0, 200),
      sourceSha256: sha,
      method: result.method,
      notes: json(result.notes),
      draft: json(result.draft),
    },
  });
  await audit({
    tenantId,
    actor: actor.email,
    actorRole: actor.role,
    action: 'policy.draft.create',
    target: draft.id,
    detail: {
      sourceName: draft.sourceName,
      method: result.method,
      llm: llm ? llm.endpointHost : null,
    },
  });
  return { ok: true, draftId: draft.id, result };
}

export async function reviewPolicyDraft(
  tenantId: string,
  draftId: string,
  decision: 'accepted' | 'rejected',
  actor: { email: string; role?: string },
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const draft = await prisma.policyDraft.findFirstOrThrow({ where: { id: draftId, tenantId } });
  if (decision === 'accepted') {
    const parsed = PolicySchema.safeParse(draft.draft);
    if (!parsed.success)
      return {
        ok: false,
        errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      };
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        policy: json({ ...parsed.data, version: `from ${draft.sourceName}` }),
        policyUpdatedAt: new Date(),
        policyUpdatedBy: actor.email,
      },
    });
  }
  await prisma.policyDraft.update({
    where: { id: draft.id },
    data: { status: decision, reviewedBy: actor.email, reviewedAt: new Date() },
  });
  await audit({
    tenantId,
    actor: actor.email,
    actorRole: actor.role,
    action: `policy.draft.${decision === 'accepted' ? 'accept' : 'reject'}`,
    target: draft.id,
  });
  return { ok: true };
}
