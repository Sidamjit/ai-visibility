/**
 * Tenant provisioning used by the worker CLI (pilot onboarding).
 */
import bcrypt from 'bcryptjs';
import { getConnector, consoleLogger, type AuthCheckResult } from '@aiv/connectors';
import { isRole, type Role } from '@aiv/core';
import { prisma } from '@aiv/db';

export interface CreateTenantInput {
  name: string;
  slug: string;
  admin: { email: string; name: string; password: string; role?: Role };
  /** Connector ids to attach, e.g. ['microsoft-graph']. */
  connectors: string[];
}

export async function createTenant(input: CreateTenantInput): Promise<{ tenantId: string }> {
  for (const id of input.connectors)
    if (!getConnector(id)) throw new Error(`Unknown connector '${id}'`);
  const role = input.admin.role ?? 'IT';
  if (!isRole(role)) throw new Error(`Invalid role '${role}'`);
  if (input.admin.password.length < 12)
    throw new Error('Admin password must be at least 12 characters.');
  const tenant = await prisma.tenant.create({ data: { name: input.name, slug: input.slug } });
  await prisma.appUser.create({
    data: {
      tenantId: tenant.id,
      email: input.admin.email.toLowerCase(),
      name: input.admin.name,
      role,
      passwordHash: await bcrypt.hash(input.admin.password, 12),
    },
  });
  for (const id of input.connectors) {
    const c = getConnector(id)!;
    await prisma.connectorInstance.create({
      data: { tenantId: tenant.id, connectorId: id, displayName: c.displayName, config: {} },
    });
  }
  return { tenantId: tenant.id };
}

/** Add another app user (any role) to an existing tenant. */
export async function addAppUser(
  slug: string,
  user: { email: string; name: string; password: string; role: Role; department?: string },
) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug } });
  if (user.password.length < 12) throw new Error('Password must be at least 12 characters.');
  return prisma.appUser.create({
    data: {
      tenantId: tenant.id,
      email: user.email.toLowerCase(),
      name: user.name,
      role: user.role,
      department: user.department ?? null,
      passwordHash: await bcrypt.hash(user.password, 12),
    },
  });
}

/** Run `authenticate()` for every connector of a tenant (permission check). */
export async function checkConnectors(
  slug: string,
): Promise<Array<{ connector: string; result: AuthCheckResult }>> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug },
    include: { connectors: true },
  });
  const out: Array<{ connector: string; result: AuthCheckResult }> = [];
  for (const inst of tenant.connectors) {
    const c = getConnector(inst.connectorId);
    if (!c) continue;
    const config = c.configSchema.parse(inst.config ?? {});
    const secrets = Object.fromEntries(c.secretEnvVars.map((k) => [k, process.env[k]]));
    out.push({
      connector: inst.connectorId,
      result: await c.authenticate({ tenantId: tenant.id, config, secrets, logger: consoleLogger }),
    });
  }
  return out;
}
