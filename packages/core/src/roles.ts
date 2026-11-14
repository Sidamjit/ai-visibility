/**
 * Application roles and the dashboards each role may open.
 *
 * Roles are deliberately coarse for the pilot:
 *  - IT:        full technical detail (file/site names, people, remediation steps).
 *  - EXECUTIVE: aggregated risk, spend and value. Can also see manager views.
 *  - MANAGER:   their teams' adoption and capability gaps; no tenant-wide exposure detail.
 *
 * The middleware in `apps/web/middleware.ts` enforces `ROUTE_ACCESS`; pages also
 * call `requireRole()` server-side so access does not depend on middleware alone.
 */
export const ROLES = ['IT', 'EXECUTIVE', 'MANAGER'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Route prefix -> roles allowed. First matching prefix wins (order matters). */
export const ROUTE_ACCESS: ReadonlyArray<{ prefix: string; roles: readonly Role[] }> = [
  { prefix: '/it', roles: ['IT'] },
  { prefix: '/connectors', roles: ['IT'] },
  { prefix: '/executive', roles: ['IT', 'EXECUTIVE'] },
  { prefix: '/report', roles: ['IT', 'EXECUTIVE'] },
  { prefix: '/settings', roles: ['IT', 'EXECUTIVE'] },
  { prefix: '/manager', roles: ['IT', 'EXECUTIVE', 'MANAGER'] },
  { prefix: '/recommendations', roles: ['IT', 'EXECUTIVE', 'MANAGER'] },
];

/** Returns true when `role` may open `pathname`. Unlisted paths are open to any signed-in user. */
export function canAccess(role: Role, pathname: string): boolean {
  const rule = ROUTE_ACCESS.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  );
  return rule ? rule.roles.includes(role) : true;
}

/** Landing page per role after sign-in. */
export const HOME_FOR_ROLE: Record<Role, string> = {
  IT: '/it',
  EXECUTIVE: '/executive',
  MANAGER: '/manager',
};
