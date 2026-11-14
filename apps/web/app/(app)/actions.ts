'use server';
/**
 * Server actions (mutations). Each one re-checks the caller's role and scopes
 * every write to the caller's tenant.
 */
import { revalidatePath } from 'next/cache';
import { AssumptionsSchema, DEFAULT_ASSUMPTIONS, type Assumptions } from '@aiv/core';
import { prisma } from '@aiv/db';
import { runConnectorSync, runTenantAnalysis } from '@aiv/pipeline';
import { requireRole } from '@/lib/auth';

/** Toggle one remediation checklist step. */
export async function toggleRemediationStep(formData: FormData): Promise<void> {
  const user = await requireRole(['IT']);
  const findingKey = String(formData.get('findingKey'));
  const stepIndex = Number(formData.get('stepIndex'));
  const done = formData.get('done') === 'true';
  await prisma.remediationTask.upsert({
    where: { tenantId_findingKey_stepIndex: { tenantId: user.tenantId, findingKey, stepIndex } },
    create: {
      tenantId: user.tenantId,
      findingKey,
      stepIndex,
      done,
      doneBy: user.email,
      doneAt: done ? new Date() : null,
    },
    update: { done, doneBy: user.email, doneAt: done ? new Date() : null },
  });
  revalidatePath('/it/remediation');
}

/** Sync one connector instance now, then re-run the analysis. */
export async function syncConnectorNow(formData: FormData): Promise<void> {
  const user = await requireRole(['IT']);
  const id = String(formData.get('connectorInstanceId'));
  await runConnectorSync(user.tenantId, id);
  await runTenantAnalysis(user.tenantId);
  revalidatePath('/', 'layout');
}

/** Re-run the analysis on stored data (no sync). */
export async function rerunAnalysis(): Promise<void> {
  const user = await requireRole(['IT', 'EXECUTIVE']);
  await runTenantAnalysis(user.tenantId);
  revalidatePath('/', 'layout');
}

/** Save editable value assumptions and re-run the analysis so figures update. */
export async function saveAssumptions(formData: FormData): Promise<void> {
  const user = await requireRole(['IT', 'EXECUTIVE']);
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_ASSUMPTIONS) as Array<keyof Assumptions>) {
    const v = formData.get(key);
    if (v === null) continue;
    raw[key] = key === 'currency' ? String(v).toUpperCase() : Number(v);
  }
  const parsed = AssumptionsSchema.safeParse({ ...DEFAULT_ASSUMPTIONS, ...raw });
  if (!parsed.success)
    throw new Error(
      `Invalid assumptions: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  await prisma.tenant.update({ where: { id: user.tenantId }, data: { assumptions: parsed.data } });
  await runTenantAnalysis(user.tenantId);
  revalidatePath('/', 'layout');
}
