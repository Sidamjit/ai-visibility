/**
 * Vendor (app creator) support access — OFF by default, controlled ONLY by the
 * client's IT admin. See docs/VENDOR_ACCESS.md.
 *
 *  1. Admin enables "Allow vendor support access" (Tenant.vendorAccessEnabled).
 *  2. Admin creates a grant: vendor email, scope, reason, expiry (max 7 days).
 *     A one-time password is generated and shown ONCE to the admin, who passes
 *     it to the vendor out of band (or the vendor signs in via the client's SSO).
 *  3. The vendor can sign in only while the grant is active; every sign-in and
 *     page view is written to the audit log.
 *  4. Revoking (or disabling the switch, or expiry) ends access immediately:
 *     the session check re-reads the grant on every request.
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { VENDOR_SCOPES, type VendorScope } from '@aiv/core';
import { prisma } from '@aiv/db';
import { audit } from './audit';

export const MAX_VENDOR_GRANT_HOURS = 168;

type Actor = { email: string; role?: string };

export async function setVendorAccessEnabled(tenantId: string, enabled: boolean, actor: Actor) {
  await prisma.tenant.update({ where: { id: tenantId }, data: { vendorAccessEnabled: enabled } });
  if (!enabled) {
    const active = await prisma.vendorAccessGrant.findMany({
      where: { tenantId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    for (const g of active) await revokeVendorAccess(tenantId, g.id, actor, 'switch disabled');
  }
  await audit({
    tenantId,
    actor: actor.email,
    actorRole: actor.role,
    action: enabled ? 'vendor.enable' : 'vendor.disable',
  });
}

export interface GrantInput {
  email: string;
  name: string;
  scope: VendorScope;
  hours: number;
  reason: string;
}

export async function grantVendorAccess(
  tenantId: string,
  input: GrantInput,
  actor: Actor,
): Promise<
  | { ok: true; grantId: string; oneTimePassword: string; expiresAt: Date }
  | { ok: false; error: string }
> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (!tenant.vendorAccessEnabled)
    return { ok: false, error: 'Vendor support access is switched off for this organisation.' };
  if (!(VENDOR_SCOPES as readonly string[]).includes(input.scope))
    return { ok: false, error: 'Unknown scope.' };
  if (!Number.isFinite(input.hours) || input.hours < 1 || input.hours > MAX_VENDOR_GRANT_HOURS)
    return { ok: false, error: `Expiry must be between 1 and ${MAX_VENDOR_GRANT_HOURS} hours.` };
  if (input.reason.trim().length < 5)
    return { ok: false, error: 'Give a reason (ticket / issue).' };
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Invalid email.' };

  const existing = await prisma.appUser.findUnique({ where: { email } });
  if (existing && (existing.tenantId !== tenantId || existing.role !== 'VENDOR_SUPPORT'))
    return { ok: false, error: 'That email already belongs to a non-vendor user.' };

  const oneTimePassword = randomBytes(18).toString('base64url');
  const passwordHash = await bcrypt.hash(oneTimePassword, 12);
  const user = existing
    ? await prisma.appUser.update({
        where: { id: existing.id },
        data: { passwordHash, name: input.name },
      })
    : await prisma.appUser.create({
        data: { tenantId, email, name: input.name, role: 'VENDOR_SUPPORT', passwordHash },
      });
  const expiresAt = new Date(Date.now() + input.hours * 3_600_000);
  const grant = await prisma.vendorAccessGrant.create({
    data: {
      tenantId,
      appUserId: user.id,
      email,
      scope: input.scope,
      reason: input.reason.trim().slice(0, 500),
      grantedBy: actor.email,
      expiresAt,
    },
  });
  await audit({
    tenantId,
    actor: actor.email,
    actorRole: actor.role,
    action: 'vendor.grant',
    target: email,
    detail: { grantId: grant.id, scope: input.scope, expiresAt: expiresAt.toISOString() },
  });
  return { ok: true, grantId: grant.id, oneTimePassword, expiresAt };
}

export async function revokeVendorAccess(
  tenantId: string,
  grantId: string,
  actor: Actor,
  why = 'revoked by admin',
) {
  const grant = await prisma.vendorAccessGrant.findFirstOrThrow({
    where: { id: grantId, tenantId },
  });
  if (!grant.revokedAt)
    await prisma.vendorAccessGrant.update({
      where: { id: grant.id },
      data: { revokedAt: new Date(), revokedBy: actor.email },
    });
  // No other active grant → remove the credential entirely.
  const other = await activeVendorGrant(grant.appUserId);
  if (!other)
    await prisma.appUser.update({ where: { id: grant.appUserId }, data: { passwordHash: null } });
  await audit({
    tenantId,
    actor: actor.email,
    actorRole: actor.role,
    action: 'vendor.revoke',
    target: grant.email,
    detail: { grantId, why },
  });
}

/** The active grant for a vendor user, or null (expired, revoked, or switch off). */
export async function activeVendorGrant(appUserId: string, now = new Date()) {
  const grant = await prisma.vendorAccessGrant.findFirst({
    where: { appUserId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { expiresAt: 'desc' },
  });
  if (!grant) return null;
  const tenant = await prisma.tenant.findUnique({ where: { id: grant.tenantId } });
  return tenant?.vendorAccessEnabled ? grant : null;
}

export async function listVendorGrants(tenantId: string) {
  return prisma.vendorAccessGrant.findMany({
    where: { tenantId },
    orderBy: { grantedAt: 'desc' },
    take: 100,
  });
}
