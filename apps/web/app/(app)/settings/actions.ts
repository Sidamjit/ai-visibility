'use server';
/**
 * Settings mutations: policy, content scanning, vendor access. IT admins only;
 * the vendor role never passes (`WRITE`). Every change is audit-logged by the
 * pipeline functions.
 */
import { revalidatePath } from 'next/cache';
import { NZ_PSR_SAMPLE_POLICY, policyToYaml } from '@aiv/policy';
import { type SNIPPET_MODES, type ScanSettings } from '@aiv/core';
import {
  draftPolicyFromDocument,
  grantVendorAccess,
  resetTenantPolicy,
  reviewPolicyDraft,
  revokeVendorAccess,
  runTenantAnalysis,
  saveScanSettings,
  saveTenantPolicy,
  setVendorAccessEnabled,
} from '@aiv/pipeline';
import { requireRole, WRITE } from '@/lib/auth';

export interface FormState {
  ok?: boolean;
  message?: string;
  errors?: string[];
  warnings?: string[];
  /** Policy editor: text to keep in the textarea after submit. */
  text?: string;
  /** Vendor grant: one-time password, shown once. */
  secret?: { email: string; password: string; expiresAt: string };
}

const actorOf = (u: { email: string; role: string }) => ({ email: u.email, role: u.role });

export async function savePolicyAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole(['IT'], WRITE);
  const text = String(formData.get('policy') ?? '');
  if (formData.get('intent') === 'sample')
    return {
      text: policyToYaml(NZ_PSR_SAMPLE_POLICY),
      message: 'NZ sample loaded — review and save.',
    };
  const out = await saveTenantPolicy(user.tenantId, text, actorOf(user));
  if (!out.ok) return { ok: false, errors: out.errors, text };
  await runTenantAnalysis(user.tenantId);
  revalidatePath('/', 'layout');
  return {
    ok: true,
    text,
    warnings: out.warnings,
    message: `Saved "${out.policy.name}" and re-evaluated all scanned files (no re-scan needed).`,
  };
}

export async function resetPolicyAction(): Promise<void> {
  const user = await requireRole(['IT'], WRITE);
  await resetTenantPolicy(user.tenantId, actorOf(user));
  await runTenantAnalysis(user.tenantId);
  revalidatePath('/', 'layout');
}

export async function uploadPolicyDocumentAction(
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(['IT'], WRITE);
  const file = formData.get('document');
  if (!(file instanceof File) || file.size === 0) return { ok: false, errors: ['Choose a file.'] };
  const out = await draftPolicyFromDocument(
    user.tenantId,
    { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
    actorOf(user),
  );
  revalidatePath('/settings/policy');
  if (!out.ok) return { ok: false, errors: [out.error] };
  return {
    ok: true,
    message: `Draft created from "${file.name}" (${out.result.method}). Review it below — nothing is applied until you accept it.`,
  };
}

export async function reviewDraftAction(formData: FormData): Promise<void> {
  const user = await requireRole(['IT'], WRITE);
  const decision = formData.get('decision') === 'accept' ? 'accepted' : 'rejected';
  const out = await reviewPolicyDraft(
    user.tenantId,
    String(formData.get('draftId')),
    decision,
    actorOf(user),
  );
  if (!out.ok) throw new Error(out.errors.join('; '));
  if (decision === 'accepted') await runTenantAnalysis(user.tenantId);
  revalidatePath('/', 'layout');
}

export async function saveScanSettingsAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole(['IT'], WRITE);
  const n = (k: string) => Number(formData.get(k));
  const input: Partial<ScanSettings> = {
    enabled: formData.get('enabled') === 'on',
    maxFileSizeMb: n('maxFileSizeMb'),
    allowedExtensions: String(formData.get('allowedExtensions') ?? '')
      .split(/[\s,]+/)
      .map((x) => x.replace(/^\./, '').toLowerCase())
      .filter(Boolean),
    concurrency: n('concurrency'),
    maxFilesPerRun: n('maxFilesPerRun'),
    maxTextChars: n('maxTextChars'),
    snippetMode: String(formData.get('snippetMode')) as (typeof SNIPPET_MODES)[number],
    snippetContextChars: n('snippetContextChars'),
    maxSnippetsPerClassifier: n('maxSnippetsPerClassifier'),
    llmEnabled: formData.get('llmEnabled') === 'on',
  };
  const out = await saveScanSettings(user.tenantId, input, actorOf(user));
  revalidatePath('/settings/scanning');
  if (!out.ok) return { ok: false, errors: out.errors };
  return { ok: true, message: 'Saved. Settings apply from the next sync.' };
}

export async function toggleVendorAccessAction(formData: FormData): Promise<void> {
  const user = await requireRole(['IT'], WRITE);
  await setVendorAccessEnabled(user.tenantId, formData.get('enabled') === 'true', actorOf(user));
  revalidatePath('/settings/vendor-access');
}

export async function grantVendorAccessAction(
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole(['IT'], WRITE);
  const email = String(formData.get('email') ?? '');
  const out = await grantVendorAccess(
    user.tenantId,
    {
      email,
      name: String(formData.get('name') || 'Vendor support'),
      scope: String(formData.get('scope')) as 'diagnostics' | 'read-only',
      hours: Number(formData.get('hours')),
      reason: String(formData.get('reason') ?? ''),
    },
    actorOf(user),
  );
  revalidatePath('/settings/vendor-access');
  if (!out.ok) return { ok: false, errors: [out.error] };
  return {
    ok: true,
    secret: {
      email: email.trim().toLowerCase(),
      password: out.oneTimePassword,
      expiresAt: out.expiresAt.toISOString(),
    },
  };
}

export async function revokeVendorGrantAction(formData: FormData): Promise<void> {
  const user = await requireRole(['IT'], WRITE);
  await revokeVendorAccess(user.tenantId, String(formData.get('grantId')), actorOf(user));
  revalidatePath('/settings/vendor-access');
}
