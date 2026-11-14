/**
 * Normalized domain model.
 *
 * Every connector (Microsoft Graph, demo, ChatGPT Enterprise, ...) translates its
 * source-specific API shapes into THESE types. The analysis engine and the web
 * app only ever see normalized data, so adding a new source never requires
 * changing a rule or a dashboard.
 *
 * Design rules (see docs/ARCHITECTURE.md):
 *  1. No CONTENT. Never add a field that carries file/message content. Content
 *     scanning produces `ContentScan` results (classifier counts, hashes,
 *     optional redacted snippets) — see content.ts.
 *  2. `externalId` is the stable ID in the source system; `connectorId` says which source.
 *  3. Dates are ISO-8601 strings at this layer (JSON-friendly); the DB layer converts.
 *  4. Use zod schemas so connector output is validated at the boundary.
 */
import { z } from 'zod';
import { ContentScanSchema } from './content';

const isoDate = z.iso.datetime({ offset: true });

/** An organisational unit (Entra `department` attribute, HR system, etc.). */
export const DepartmentSchema = z.object({
  externalId: z.string(),
  name: z.string(),
});
export type Department = z.infer<typeof DepartmentSchema>;

/** A person or guest account. */
export const IdentitySchema = z.object({
  externalId: z.string(),
  displayName: z.string(),
  /** UPN or email. Used for joining usage reports; treat as personal data. */
  email: z.string().nullable(),
  departmentName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  /** External / B2B guest account. */
  isGuest: z.boolean(),
  accountEnabled: z.boolean(),
  /** Last interactive sign-in (needs AuditLog.Read.All + Entra ID P1). */
  lastSignInAt: isoDate.nullable(),
});
export type Identity = z.infer<typeof IdentitySchema>;

export const AI_ASSET_KINDS = [
  'copilot',
  'chat-assistant',
  'agent',
  'custom-model',
  'lms-ai',
  'other',
] as const;

/** An AI tool / product / agent in use in the organisation. */
export const AIAssetSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  vendor: z.string(),
  kind: z.enum(AI_ASSET_KINDS),
  /** Whether this asset can read organisational content (drives oversharing risk). */
  groundedOnOrgData: z.boolean(),
});
export type AIAsset = z.infer<typeof AIAssetSchema>;

/** A paid seat assigned to an identity. */
export const LicenceSchema = z.object({
  identityExternalId: z.string(),
  assetExternalId: z.string(),
  skuId: z.string(),
  skuName: z.string(),
  assignedAt: isoDate.nullable(),
});
export type Licence = z.infer<typeof LicenceSchema>;

/**
 * Per-user usage over a reporting period (e.g. Copilot usage report D30).
 * `featureLastActivity` maps a feature/app (e.g. 'teams', 'word') to the last
 * date it was used, or null if never used in the period.
 */
export const UsageSummarySchema = z.object({
  identityExternalId: z.string(),
  assetExternalId: z.string(),
  periodStart: isoDate,
  periodEnd: isoDate,
  lastActivityAt: isoDate.nullable(),
  /** Days with at least one AI interaction in the period, when the source provides it. */
  activeDays: z.number().int().nonnegative().nullable(),
  featureLastActivity: z.record(z.string(), isoDate.nullable()),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

export const LOCATION_KINDS = ['site', 'library', 'folder', 'file', 'onedrive', 'team'] as const;

/** A place content lives (SharePoint site, document library, OneDrive, folder or file). */
export const ContentLocationSchema = z.object({
  externalId: z.string(),
  parentExternalId: z.string().nullable(),
  kind: z.enum(LOCATION_KINDS),
  /** Display name. Content findings live in ContentScan, keyed by this location's externalId. */
  name: z.string(),
  webUrl: z.string().nullable(),
  /** Root site this location belongs to (itself for a site). Used for per-site rollups. */
  siteExternalId: z.string().nullable(),
  ownerDepartment: z.string().nullable(),
  /** 'public' = anyone in the org can join/see (M365 group visibility). */
  visibility: z.enum(['public', 'private', 'unknown']),
  memberCount: z.number().int().nonnegative().nullable(),
  guestMemberCount: z.number().int().nonnegative().nullable(),
  itemCount: z.number().int().nonnegative().nullable(),
  lastModifiedAt: isoDate.nullable(),
  sensitivityLabelId: z.string().nullable(),
  /** True when permissions are not inherited from the parent (broken inheritance). */
  hasUniquePermissions: z.boolean(),
  /**
   * Heuristic: metadata suggests sensitive content (name keywords such as
   * "payroll", "passport", label, or DLP signal). Content-based evidence is
   * carried separately in ContentScan.
   */
  likelySensitive: z.boolean(),
  sensitivityReasons: z.array(z.string()),
});
export type ContentLocation = z.infer<typeof ContentLocationSchema>;

export const SHARING_SCOPES = [
  'anyone',
  'organization',
  'specific-people',
  'direct',
  'external-guest',
] as const;
export type SharingScope = (typeof SHARING_SCOPES)[number];

/** One way a location is exposed: a sharing link or a direct permission grant. */
export const SharingGrantSchema = z.object({
  externalId: z.string(),
  locationExternalId: z.string(),
  scope: z.enum(SHARING_SCOPES),
  /** 'read' | 'write' | 'owner' etc., normalized lower-case. */
  roles: z.array(z.string()),
  /** Identity IDs granted (empty for anyone/organization links). */
  grantedToExternalIds: z.array(z.string()),
  /** Count of external (guest/outside) principals in this grant. */
  externalPrincipalCount: z.number().int().nonnegative(),
  createdAt: isoDate.nullable(),
  expiresAt: isoDate.nullable(),
  /** True if inherited from a parent location (not a new exposure). */
  inherited: z.boolean(),
});
export type SharingGrant = z.infer<typeof SharingGrantSchema>;

/** A Microsoft Purview (or other) sensitivity label definition. */
export const SensitivityLabelSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  /** Higher = more sensitive (Purview priority/sensitivity). */
  priority: z.number().int(),
  /** Labels at/above this level are treated as "sensitive" by rules. */
  isSensitive: z.boolean(),
});
export type SensitivityLabel = z.infer<typeof SensitivityLabelSchema>;

/** A recurring cost (licences, API spend, platform fees). Monthly, in `currency`. */
export const CostItemSchema = z.object({
  externalId: z.string(),
  assetExternalId: z.string(),
  category: z.enum(['licence', 'consumption', 'platform', 'services']),
  description: z.string(),
  monthlyAmount: z.number().nonnegative(),
  currency: z.string().length(3),
});
export type CostItem = z.infer<typeof CostItemSchema>;

/**
 * Everything one connector sync produced. Connectors may emit several batches;
 * the worker upserts each one. `cursor` is opaque to everyone except the connector.
 */
export const NormalizedBatchSchema = z.object({
  departments: z.array(DepartmentSchema).default([]),
  identities: z.array(IdentitySchema).default([]),
  assets: z.array(AIAssetSchema).default([]),
  licences: z.array(LicenceSchema).default([]),
  usage: z.array(UsageSummarySchema).default([]),
  locations: z.array(ContentLocationSchema).default([]),
  grants: z.array(SharingGrantSchema).default([]),
  labels: z.array(SensitivityLabelSchema).default([]),
  costs: z.array(CostItemSchema).default([]),
  /** Content-scan results for files (classifier counts only, never content). */
  contentScans: z.array(ContentScanSchema).default([]),
});
export type NormalizedBatch = z.infer<typeof NormalizedBatchSchema>;

/** Convenience: an empty batch with all arrays present. */
export function emptyBatch(): NormalizedBatch {
  return {
    departments: [],
    identities: [],
    assets: [],
    licences: [],
    usage: [],
    locations: [],
    grants: [],
    labels: [],
    costs: [],
    contentScans: [],
  };
}

/** Merge batches (later batches append). Used by tests and the demo loader. */
export function mergeBatches(...batches: NormalizedBatch[]): NormalizedBatch {
  const out = emptyBatch();
  for (const b of batches) {
    for (const key of Object.keys(out) as Array<keyof NormalizedBatch>) {
      (out[key] as unknown[]).push(...(b[key] as unknown[]));
    }
  }
  return out;
}
