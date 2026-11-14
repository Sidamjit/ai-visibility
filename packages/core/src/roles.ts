/**
 * Application roles and the dashboards each role may open.
 *
 * Roles are deliberately coarse for the pilot:
 *  - IT:        full technical detail (file/site names, people, remediation steps).
 *  - EXECUTIVE: aggregated risk, spend and value. Can also see manager views.
 *  - MANAGER:   their teams' adoption and capability gaps; no tenant-wide exposure detail.
 *  - VENDOR_SUPPORT: the app vendor, ONLY while the client has granted time-boxed
 *    access (see docs/VENDOR_ACCESS.md). Never writes. Scope 'diagnostics' opens
 *    /support only (sync health, versions, no findings or names); scope
 *    'read-only' additionally opens the IT/executive views. Settings, vendor
 *    access and the audit log are never open to the vendor.
 *
 * The middleware in `apps/web/middleware.ts` enforces `ROUTE_ACCESS`; pages also
 * call `requireRole()` server-side so access does not depend on middleware alone.
 */
export const ROLES = ['IT', 'EXECUTIVE', 'MANAGER', 'VENDOR_SUPPORT'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Route prefix -> roles allowed. First matching prefix wins (order matters). */
export const ROUTE_ACCESS: ReadonlyArray<{ prefix: string; roles: readonly Role[] }> = [
  { prefix: '/it', roles: ['IT', 'VENDOR_SUPPORT'] },
  { prefix: '/connectors', roles: ['IT', 'VENDOR_SUPPORT'] },
  { prefix: '/executive', roles: ['IT', 'EXECUTIVE', 'VENDOR_SUPPORT'] },
  { prefix: '/report', roles: ['IT', 'EXECUTIVE', 'VENDOR_SUPPORT'] },
  { prefix: '/api/export', roles: ['IT', 'EXECUTIVE'] },
  { prefix: '/settings/vendor-access', roles: ['IT'] },
  { prefix: '/settings/audit', roles: ['IT'] },
  { prefix: '/settings/policy', roles: ['IT'] },
  { prefix: '/settings/scanning', roles: ['IT'] },
  { prefix: '/settings', roles: ['IT', 'EXECUTIVE'] },
  { prefix: '/support', roles: ['IT', 'VENDOR_SUPPORT'] },
  { prefix: '/manager', roles: ['IT', 'EXECUTIVE', 'MANAGER'] },
  { prefix: '/recommendations', roles: ['IT', 'EXECUTIVE', 'MANAGER'] },
];

export const VENDOR_SCOPES = ['diagnostics', 'read-only'] as const;
export type VendorScope = (typeof VENDOR_SCOPES)[number];

/** Paths a vendor may open per grant scope (on top of ROUTE_ACCESS). */
const VENDOR_SCOPE_PREFIXES: Record<VendorScope, readonly string[]> = {
  diagnostics: ['/support'],
  'read-only': ['/support', '/it', '/connectors', '/executive', '/report'],
};

const matches = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * Returns true when `role` may open `pathname`. Unlisted paths are open to any
 * signed-in user EXCEPT the vendor, who is denied by default and limited to
 * the prefixes of their grant scope.
 */
export function canAccess(role: Role, pathname: string, vendorScope?: VendorScope | null): boolean {
  if (role === 'VENDOR_SUPPORT') {
    if (!vendorScope) return false;
    if (!VENDOR_SCOPE_PREFIXES[vendorScope].some((p) => matches(pathname, p))) return false;
  }
  const rule = ROUTE_ACCESS.find((r) => matches(pathname, r.prefix));
  return rule ? rule.roles.includes(role) : true;
}

/** Landing page per role after sign-in. */
export const HOME_FOR_ROLE: Record<Role, string> = {
  IT: '/it',
  EXECUTIVE: '/executive',
  MANAGER: '/manager',
  VENDOR_SUPPORT: '/support',
};
