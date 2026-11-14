/**
 * Builds lookup indexes and shared helper predicates over a NormalizedBatch.
 *
 * Rules should use these helpers instead of re-implementing definitions such
 * as "what counts as sensitive" or "what counts as an active seat", so every
 * rule, score and dashboard agrees on the same definitions.
 */
import type {
  Assumptions,
  ContentLocation,
  Identity,
  Licence,
  NormalizedBatch,
  SharingGrant,
  UsageSummary,
} from '@aiv/core';

const DAY = 86_400_000;
export type UsageIntensity = 'none' | 'light' | 'regular' | 'power';

export interface AnalysisIndex {
  locationsById: Map<string, ContentLocation>;
  /** Top-level sites (SharePoint sites, Teams sites, OneDrives). */
  sites: ContentLocation[];
  /** siteExternalId -> every location in that site (including the site itself). */
  locationsBySite: Map<string, ContentLocation[]>;
  /** locationExternalId -> NON-inherited grants on it. */
  grantsByLocation: Map<string, SharingGrant[]>;
  identitiesById: Map<string, Identity>;
  /** identity -> Copilot-style licences (any asset). */
  licencesByIdentity: Map<string, Licence[]>;
  /** identity -> usage summaries. */
  usageByIdentity: Map<string, UsageSummary[]>;
  /** Department name -> enabled, non-guest people in it. */
  peopleByDepartment: Map<string, Identity[]>;

  isSensitive(loc: ContentLocation): boolean;
  hasSensitiveLabel(loc: ContentLocation): boolean;
  isStale(loc: ContentLocation): boolean;
  isBroadSite(site: ContentLocation): boolean;
  featureBreadth(u: UsageSummary): number;
  intensity(u: UsageSummary | undefined): UsageIntensity;
  isActiveSeat(identityId: string): boolean;
  siteOf(loc: ContentLocation): ContentLocation | undefined;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

export function buildIndex(
  data: NormalizedBatch,
  assumptions: Assumptions,
  asOf: Date,
): AnalysisIndex {
  const labelsById = new Map(data.labels.map((l) => [l.externalId, l]));
  const locationsById = new Map(data.locations.map((l) => [l.externalId, l]));
  const sites = data.locations.filter((l) => l.parentExternalId === null);
  const locationsBySite = new Map<string, ContentLocation[]>();
  for (const loc of data.locations)
    push(locationsBySite, loc.siteExternalId ?? loc.externalId, loc);

  const grantsByLocation = new Map<string, SharingGrant[]>();
  for (const g of data.grants) if (!g.inherited) push(grantsByLocation, g.locationExternalId, g);

  const identitiesById = new Map(data.identities.map((i) => [i.externalId, i]));
  const licencesByIdentity = new Map<string, Licence[]>();
  for (const l of data.licences) push(licencesByIdentity, l.identityExternalId, l);
  const usageByIdentity = new Map<string, UsageSummary[]>();
  for (const u of data.usage) push(usageByIdentity, u.identityExternalId, u);
  const peopleByDepartment = new Map<string, Identity[]>();
  for (const i of data.identities) {
    if (!i.isGuest && i.accountEnabled)
      push(peopleByDepartment, i.departmentName ?? 'Unassigned', i);
  }

  const ageDays = (iso: string | null) =>
    iso ? (asOf.getTime() - new Date(iso).getTime()) / DAY : Infinity;

  const hasSensitiveLabel = (loc: ContentLocation) =>
    Boolean(loc.sensitivityLabelId && labelsById.get(loc.sensitivityLabelId)?.isSensitive);

  const featureBreadth = (u: UsageSummary) =>
    Object.values(u.featureLastActivity).filter((d) => d !== null).length;

  const index: AnalysisIndex = {
    locationsById,
    sites,
    locationsBySite,
    grantsByLocation,
    identitiesById,
    licencesByIdentity,
    usageByIdentity,
    peopleByDepartment,
    hasSensitiveLabel,
    /** Sensitive = carries a sensitive label OR metadata heuristics flag it. */
    isSensitive: (loc) => hasSensitiveLabel(loc) || loc.likelySensitive,
    isStale: (loc) => ageDays(loc.lastModifiedAt) > assumptions.staleContentDays,
    isBroadSite: (site) =>
      site.visibility === 'public' ||
      (site.memberCount ?? 0) > assumptions.excessiveMembershipThreshold,
    featureBreadth,
    /**
     * Usage intensity. Prefer active-day counts; when the source only gives
     * last-activity dates (Graph Copilot report), infer from recency + breadth.
     */
    intensity: (u) => {
      if (!u || ageDays(u.lastActivityAt) > 30) return 'none';
      if (u.activeDays !== null) {
        if (u.activeDays === 0) return 'none';
        if (u.activeDays >= 15) return 'power';
        if (u.activeDays >= 5) return 'regular';
        return 'light';
      }
      const breadth = featureBreadth(u);
      if (breadth >= 4 && ageDays(u.lastActivityAt) <= 7) return 'power';
      if (breadth >= 2) return 'regular';
      return 'light';
    },
    isActiveSeat: (identityId) => {
      const person = identitiesById.get(identityId);
      if (person && !person.accountEnabled) return false;
      const usage = usageByIdentity.get(identityId) ?? [];
      return usage.some((u) => ageDays(u.lastActivityAt) <= assumptions.inactiveSeatDays);
    },
    siteOf: (loc) => locationsById.get(loc.siteExternalId ?? loc.externalId),
  };
  return index;
}
