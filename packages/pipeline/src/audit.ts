/**
 * Append-only audit log of who did / viewed what in this app.
 *
 * Never put file content, snippets or secrets in `detail` — targets are page
 * paths, export names, setting keys and record ids.
 */
import { prisma, type Prisma } from '@aiv/db';

export interface AuditInput {
  tenantId: string;
  actor: string;
  actorRole?: string | null;
  action: string;
  target?: string | null;
  detail?: Record<string, unknown> | null;
}

export async function audit(e: AuditInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        tenantId: e.tenantId,
        actor: e.actor,
        actorRole: e.actorRole ?? null,
        action: e.action,
        target: e.target ?? null,
        detail: (e.detail ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    // Auditing must never break the request, but must be visible in logs.
    console.error('[audit] failed to record event', e.action, (err as Error).message);
  }
}

export async function listAuditEvents(
  tenantId: string,
  opts: { take?: number; actor?: string; action?: string } = {},
) {
  return prisma.auditEvent.findMany({
    where: {
      tenantId,
      ...(opts.actor ? { actor: opts.actor } : {}),
      ...(opts.action ? { action: { startsWith: opts.action } } : {}),
    },
    orderBy: { at: 'desc' },
    take: Math.min(opts.take ?? 200, 2000),
  });
}
