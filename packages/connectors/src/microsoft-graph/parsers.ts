/**
 * Pure functions that translate raw Microsoft Graph JSON into the normalized
 * model. Kept separate from HTTP so they can be unit-tested with recorded
 * fixtures (see `__fixtures__/graph.ts`). No I/O in this file.
 */
import {
  sensitiveNameReasons,
  type ContentLocation,
  type Identity,
  type Licence,
  type SensitivityLabel,
  type SharingGrant,
  type SharingScope,
  type UsageSummary,
} from '@aiv/core';

// ---------- Raw Graph shapes (only the fields we $select) ----------

export interface GraphUser {
  id: string;
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  userType?: string | null;
  accountEnabled?: boolean | null;
  assignedLicenses?: Array<{ skuId: string }>;
  signInActivity?: { lastSignInDateTime?: string | null } | null;
}

export interface GraphSku {
  skuId: string;
  skuPartNumber: string;
}

export interface GraphSite {
  id: string;
  name?: string | null;
  displayName?: string | null;
  webUrl?: string | null;
  lastModifiedDateTime?: string | null;
  isPersonalSite?: boolean | null;
}

export interface GraphGroup {
  id: string;
  displayName?: string | null;
  visibility?: string | null;
  assignedLabels?: Array<{ labelId: string; displayName?: string }> | null;
}

export interface GraphDrive {
  id: string;
  name?: string | null;
  webUrl?: string | null;
  driveType?: string | null;
  lastModifiedDateTime?: string | null;
}

export interface GraphDriveItem {
  id: string;
  name?: string | null;
  webUrl?: string | null;
  lastModifiedDateTime?: string | null;
  parentReference?: { id?: string; driveId?: string; path?: string } | null;
  folder?: { childCount?: number } | null;
  file?: Record<string, unknown> | null;
  shared?: { scope?: string } | null;
  root?: Record<string, unknown> | null;
  deleted?: { state?: string } | null;
}

export interface GraphIdentity {
  id?: string;
  displayName?: string;
  email?: string;
  loginName?: string;
}

export interface GraphPermission {
  id: string;
  roles?: string[];
  link?: { scope?: string; type?: string; webUrl?: string } | null;
  grantedToV2?: {
    user?: GraphIdentity;
    siteUser?: GraphIdentity;
    group?: GraphIdentity;
    siteGroup?: GraphIdentity;
  } | null;
  grantedToIdentitiesV2?: Array<{
    user?: GraphIdentity;
    siteUser?: GraphIdentity;
    group?: GraphIdentity;
  }> | null;
  inheritedFrom?: { id?: string; path?: string } | null;
  expirationDateTime?: string | null;
  hasPassword?: boolean;
}

export interface GraphCopilotUsageRow {
  reportRefreshDate?: string;
  userPrincipalName?: string;
  displayName?: string;
  lastActivityDate?: string | null;
  microsoftTeamsCopilotLastActivityDate?: string | null;
  wordCopilotLastActivityDate?: string | null;
  excelCopilotLastActivityDate?: string | null;
  powerPointCopilotLastActivityDate?: string | null;
  outlookCopilotLastActivityDate?: string | null;
  oneNoteCopilotLastActivityDate?: string | null;
  loopCopilotLastActivityDate?: string | null;
  copilotChatLastActivityDate?: string | null;
  copilotActivityUserDetailsByPeriod?: Array<{ reportPeriod?: number }>;
}

export interface GraphSensitivityLabel {
  id: string;
  name?: string;
  displayName?: string;
  sensitivity?: number;
  priority?: number;
}

// ---------- Helpers ----------

/** Graph report dates are 'YYYY-MM-DD'; normalize to full ISO or null. */
export function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Guest accounts have userType 'Guest' and/or '#EXT#' in the UPN. */
export function isGuestPrincipal(
  identity: GraphIdentity | undefined,
  guestIds: ReadonlySet<string>,
): boolean {
  if (!identity) return false;
  if (identity.id && guestIds.has(identity.id)) return true;
  const login = `${identity.loginName ?? ''} ${identity.email ?? ''}`.toLowerCase();
  return login.includes('#ext#') || login.includes('urn:spo:guest');
}

// ---------- Parsers ----------

export function parseUser(u: GraphUser): Identity {
  return {
    externalId: u.id,
    displayName: u.displayName ?? u.userPrincipalName ?? u.id,
    email: u.mail ?? u.userPrincipalName ?? null,
    departmentName: u.department?.trim() || null,
    jobTitle: u.jobTitle ?? null,
    isGuest:
      (u.userType ?? '').toLowerCase() === 'guest' || (u.userPrincipalName ?? '').includes('#EXT#'),
    accountEnabled: u.accountEnabled ?? true,
    lastSignInAt: toIsoDate(u.signInActivity?.lastSignInDateTime ?? null),
  };
}

/** Copilot SKUs are identified by part number (e.g. 'Microsoft_365_Copilot'). */
export function isCopilotSku(sku: GraphSku): boolean {
  return /copilot/i.test(sku.skuPartNumber);
}

export const COPILOT_ASSET_ID = 'm365-copilot';

export function parseCopilotLicences(users: GraphUser[], skus: GraphSku[]): Licence[] {
  const copilotSkus = new Map(skus.filter(isCopilotSku).map((s) => [s.skuId, s.skuPartNumber]));
  const out: Licence[] = [];
  for (const u of users) {
    for (const l of u.assignedLicenses ?? []) {
      const name = copilotSkus.get(l.skuId);
      if (name) {
        out.push({
          identityExternalId: u.id,
          assetExternalId: COPILOT_ASSET_ID,
          skuId: l.skuId,
          skuName: name,
          assignedAt: null, // Graph does not expose assignment date on /users; see licenseAssignmentStates for group-based.
        });
      }
    }
  }
  return out;
}

/** Feature keys used across the product for Copilot app breadth. */
export const COPILOT_FEATURES = [
  'teams',
  'word',
  'excel',
  'powerpoint',
  'outlook',
  'onenote',
  'loop',
  'chat',
] as const;

export function parseCopilotUsageRow(
  row: GraphCopilotUsageRow,
  upnToUserId: ReadonlyMap<string, string>,
  periodDays = 30,
): UsageSummary | null {
  const upn = row.userPrincipalName?.toLowerCase();
  const userId = upn ? upnToUserId.get(upn) : undefined;
  if (!userId) return null; // Unknown or concealed (hashed) user — see PILOT_SETUP.md "report concealment".
  const end = toIsoDate(row.reportRefreshDate) ?? new Date().toISOString();
  const start = new Date(new Date(end).getTime() - periodDays * 86_400_000).toISOString();
  const featureLastActivity: Record<string, string | null> = {
    teams: toIsoDate(row.microsoftTeamsCopilotLastActivityDate),
    word: toIsoDate(row.wordCopilotLastActivityDate),
    excel: toIsoDate(row.excelCopilotLastActivityDate),
    powerpoint: toIsoDate(row.powerPointCopilotLastActivityDate),
    outlook: toIsoDate(row.outlookCopilotLastActivityDate),
    onenote: toIsoDate(row.oneNoteCopilotLastActivityDate),
    loop: toIsoDate(row.loopCopilotLastActivityDate),
    chat: toIsoDate(row.copilotChatLastActivityDate),
  };
  return {
    identityExternalId: userId,
    assetExternalId: COPILOT_ASSET_ID,
    periodStart: start,
    periodEnd: end,
    lastActivityAt: toIsoDate(row.lastActivityDate),
    activeDays: null, // The user-detail report gives last-activity dates, not day counts.
    featureLastActivity,
  };
}

export function parseSite(
  site: GraphSite,
  group: (GraphGroup & { memberCount: number | null; guestCount: number | null }) | undefined,
): ContentLocation {
  const name = site.displayName ?? site.name ?? site.id;
  const reasons = sensitiveNameReasons(name);
  const labelId = group?.assignedLabels?.[0]?.labelId ?? null;
  const visibility = group?.visibility?.toLowerCase();
  return {
    externalId: site.id,
    parentExternalId: null,
    kind: site.isPersonalSite ? 'onedrive' : group ? 'team' : 'site',
    name,
    webUrl: site.webUrl ?? null,
    siteExternalId: site.id,
    ownerDepartment: null,
    visibility:
      visibility === 'public' ? 'public' : visibility === 'private' ? 'private' : 'unknown',
    memberCount: group?.memberCount ?? null,
    guestMemberCount: group?.guestCount ?? null,
    itemCount: null,
    lastModifiedAt: toIsoDate(site.lastModifiedDateTime),
    sensitivityLabelId: labelId,
    hasUniquePermissions: false,
    likelySensitive: reasons.length > 0,
    sensitivityReasons: reasons,
  };
}

export function parseDrive(drive: GraphDrive, siteId: string): ContentLocation {
  const name = drive.name ?? drive.id;
  const reasons = sensitiveNameReasons(name);
  return {
    externalId: drive.id,
    parentExternalId: siteId,
    kind: drive.driveType === 'personal' ? 'onedrive' : 'library',
    name,
    webUrl: drive.webUrl ?? null,
    siteExternalId: siteId,
    ownerDepartment: null,
    visibility: 'unknown',
    memberCount: null,
    guestMemberCount: null,
    itemCount: null,
    lastModifiedAt: toIsoDate(drive.lastModifiedDateTime),
    sensitivityLabelId: null,
    hasUniquePermissions: false,
    likelySensitive: reasons.length > 0,
    sensitivityReasons: reasons,
  };
}

export function parseDriveItem(
  item: GraphDriveItem,
  driveId: string,
  siteId: string,
): ContentLocation {
  const name = item.name ?? item.id;
  // Path segments are names too: "Finance/Payroll/2024.xlsx" is sensitive even if the file name isn't.
  const pathHint = item.parentReference?.path?.split(':').pop() ?? '';
  const reasons = Array.from(
    new Set([...sensitiveNameReasons(name), ...sensitiveNameReasons(pathHint)]),
  );
  return {
    externalId: item.id,
    parentExternalId: item.parentReference?.id ?? driveId,
    kind: item.folder ? 'folder' : 'file',
    name,
    webUrl: item.webUrl ?? null,
    siteExternalId: siteId,
    ownerDepartment: null,
    visibility: 'unknown',
    memberCount: null,
    guestMemberCount: null,
    itemCount: item.folder?.childCount ?? null,
    lastModifiedAt: toIsoDate(item.lastModifiedDateTime),
    sensitivityLabelId: null,
    hasUniquePermissions: false,
    likelySensitive: reasons.length > 0,
    sensitivityReasons: reasons,
  };
}

/**
 * Translate a driveItem permission into a normalized SharingGrant.
 *
 * Mapping (https://learn.microsoft.com/graph/api/resources/permission):
 *  - link.scope 'anonymous'     -> 'anyone'        (no sign-in needed: highest risk)
 *  - link.scope 'organization'  -> 'organization'  (everyone in the tenant, incl. Copilot reach)
 *  - link.scope 'users'         -> 'specific-people' (or 'external-guest' if any recipient is external)
 *  - no link, direct grant      -> 'direct' (or 'external-guest')
 *  - `inheritedFrom` present    -> inherited = true (not a new exposure at this level)
 */
export function parsePermission(
  p: GraphPermission,
  locationId: string,
  guestIds: ReadonlySet<string>,
): SharingGrant {
  const principals: GraphIdentity[] = [];
  const g2 = p.grantedToV2;
  if (g2) {
    const one = g2.user ?? g2.siteUser ?? g2.group ?? g2.siteGroup;
    if (one) principals.push(one);
  }
  for (const g of p.grantedToIdentitiesV2 ?? []) {
    const one = g.user ?? g.siteUser ?? g.group;
    if (one) principals.push(one);
  }
  const externalCount = principals.filter((x) => isGuestPrincipal(x, guestIds)).length;

  let scope: SharingScope;
  const linkScope = p.link?.scope?.toLowerCase();
  if (linkScope === 'anonymous') scope = 'anyone';
  else if (linkScope === 'organization') scope = 'organization';
  else if (externalCount > 0) scope = 'external-guest';
  else if (linkScope === 'users' || linkScope === 'existingaccess') scope = 'specific-people';
  else scope = 'direct';

  return {
    externalId: `${locationId}:${p.id}`,
    locationExternalId: locationId,
    scope,
    roles: (p.roles ?? []).map((r) => r.toLowerCase()),
    grantedToExternalIds: principals.map((x) => x.id).filter((x): x is string => Boolean(x)),
    externalPrincipalCount: externalCount,
    createdAt: null,
    expiresAt: toIsoDate(p.expirationDateTime ?? null),
    inherited: Boolean(p.inheritedFrom && (p.inheritedFrom.id || p.inheritedFrom.path)),
  };
}

/**
 * An item has broken inheritance when it carries at least one non-inherited,
 * non-owner permission. (Graph doesn't expose a direct flag; this is the
 * documented heuristic.)
 */
export function hasUniquePermissions(perms: SharingGrant[]): boolean {
  return perms.some((p) => !p.inherited && !p.roles.includes('owner'));
}

export function parseSensitivityLabel(
  l: GraphSensitivityLabel,
  sensitiveFromPriority: number,
): SensitivityLabel {
  const priority = l.sensitivity ?? l.priority ?? 0;
  return {
    externalId: l.id,
    name: l.displayName ?? l.name ?? l.id,
    priority,
    isSensitive: priority >= sensitiveFromPriority,
  };
}
