/**
 * Content classification index: joins content-scan results to locations,
 * classifies each scanned file against the tenant policy, and evaluates how
 * it is handled (sharing, audience, label, location, retention).
 *
 * Built once per analysis run and shared by the POL-xxx / SEC-xxx rules,
 * metrics, `isSensitive()` and the breaches dashboard.
 */
import type {
  ContentLocation,
  ContentScan,
  NormalizedBatch,
  SensitivityLabel,
  SharingGrant,
} from '@aiv/core';
import {
  BREACH_TYPES,
  classifyScan,
  evaluateHandling,
  levelById,
  type BreachType,
  type ClassificationResult,
  type ExposureFacts,
  type Policy,
  type PolicyBreach,
} from '@aiv/policy';

export interface ClassifiedFile {
  location: ContentLocation;
  site: ContentLocation | undefined;
  scan: ContentScan;
  classification: ClassificationResult;
  facts: ExposureFacts;
  breaches: PolicyBreach[];
  labelName: string | null;
  /** Display names of people/guests with specific/direct grants (max 10). */
  grantees: string[];
}

export interface ContentLevelStat {
  levelId: string;
  name: string;
  rank: number;
  color: string | null;
  files: number;
  breachingFiles: number;
}

export interface ContentMetrics {
  policyName: string;
  policyVersion: string;
  filesScanned: number;
  filesSkipped: number;
  filesFailed: number;
  bytesScanned: number;
  filesWithHits: number;
  /** Files classified above the policy's default level. */
  classifiedFiles: number;
  breachingFiles: number;
  breachesByType: Record<BreachType, number>;
  levels: ContentLevelStat[];
  classifiers: Array<{ classifierId: string; category: string; files: number; matches: number }>;
  lastScanAt: string | null;
  /** True when the scanner stored redacted snippets (snippet mode 'redacted'). */
  snippetsStored: boolean;
}

/** Row stored with the analysis run for the breaches view and CSV export (content-free). */
export interface ClassifiedFileView {
  locationExternalId: string;
  name: string;
  webUrl: string | null;
  siteExternalId: string | null;
  siteName: string | null;
  department: string | null;
  levelId: string;
  levelName: string;
  levelRank: number;
  classificationSource: ClassificationResult['source'];
  matchedRules: string[];
  classifiers: Array<{ classifierId: string; count: number; distinctValues: number }>;
  label: string | null;
  exposure: {
    anyoneLinks: number;
    organizationLinks: number;
    externalPrincipals: number;
    publicSite: boolean;
    audienceSize: number | null;
  };
  lastModifiedAt: string | null;
  breaches: Array<{ type: BreachType; message: string }>;
  snippets: string[];
}

export interface ContentIndex {
  policy: Policy;
  files: ClassifiedFile[];
  byLocation: Map<string, ClassifiedFile>;
  metrics: ContentMetrics;
}

const SCOPE_REACH = new Set(['specific-people', 'direct', 'external-guest']);

/** Every non-inherited grant on the location and its ancestors (folder, library, site). */
function chainGrants(
  loc: ContentLocation,
  locationsById: Map<string, ContentLocation>,
  grantsByLocation: Map<string, SharingGrant[]>,
): SharingGrant[] {
  const out: SharingGrant[] = [];
  const seen = new Set<string>();
  let cur: ContentLocation | undefined = loc;
  while (cur && !seen.has(cur.externalId)) {
    seen.add(cur.externalId);
    out.push(...(grantsByLocation.get(cur.externalId) ?? []));
    cur = cur.parentExternalId ? locationsById.get(cur.parentExternalId) : undefined;
  }
  return out;
}

export function buildContentIndex(
  data: NormalizedBatch,
  helpers: {
    locationsById: Map<string, ContentLocation>;
    grantsByLocation: Map<string, SharingGrant[]>;
    labelsById: Map<string, SensitivityLabel>;
    identityName: (id: string) => string | undefined;
  },
  policy: Policy,
  asOf: Date,
): ContentIndex {
  const files: ClassifiedFile[] = [];
  const defaultRank = levelById(policy, policy.defaultLevel).rank;
  for (const scan of data.contentScans) {
    if (scan.status !== 'scanned' || scan.hits.length === 0) continue;
    const location = helpers.locationsById.get(scan.locationExternalId);
    if (!location) continue; // scan of a file whose metadata was not kept (no hits) — nothing to evaluate
    const classification = classifyScan(policy, scan.hits, scan.llm);
    const site = helpers.locationsById.get(location.siteExternalId ?? location.externalId);
    const grants = chainGrants(location, helpers.locationsById, helpers.grantsByLocation);
    const library = location.parentExternalId
      ? helpers.locationsById.get(location.parentExternalId)
      : undefined;
    const labelId =
      location.sensitivityLabelId ??
      (library?.kind === 'library' ? library.sensitivityLabelId : null);
    const label = labelId ? helpers.labelsById.get(labelId) : undefined;
    const granteeIds = grants
      .filter((g) => SCOPE_REACH.has(g.scope))
      .flatMap((g) => g.grantedToExternalIds);
    const facts: ExposureFacts = {
      anyoneLinks: grants.filter((g) => g.scope === 'anyone').length,
      organizationLinks: grants.filter((g) => g.scope === 'organization').length,
      externalPrincipals: grants
        .filter((g) => g.scope === 'external-guest')
        .reduce((s, g) => s + g.externalPrincipalCount, 0),
      publicSite: site?.visibility === 'public',
      audienceSize:
        site?.memberCount === null || site?.memberCount === undefined
          ? granteeIds.length || null
          : site.memberCount + new Set(granteeIds).size,
      label: label ? { name: label.name, priority: label.priority } : null,
      siteName: site?.name ?? null,
      siteUrl: site?.webUrl ?? null,
      department: site?.ownerDepartment ?? location.ownerDepartment,
      isOneDrive: site?.kind === 'onedrive',
      lastModifiedAt: location.lastModifiedAt,
      asOf,
    };
    const breaches =
      classification.level.rank > defaultRank ? evaluateHandling(classification.level, facts) : [];
    files.push({
      location,
      site,
      scan,
      classification,
      facts,
      breaches,
      labelName: label?.name ?? null,
      grantees: [...new Set(granteeIds)]
        .slice(0, 10)
        .map((id) => helpers.identityName(id) ?? 'unknown principal'),
    });
  }
  files.sort(
    (a, b) =>
      b.classification.level.rank - a.classification.level.rank ||
      b.breaches.length - a.breaches.length,
  );

  // ---- metrics ----
  const scans = data.contentScans;
  const breachesByType = Object.fromEntries(BREACH_TYPES.map((t) => [t, 0])) as Record<
    BreachType,
    number
  >;
  for (const f of files) for (const b of f.breaches) breachesByType[b.type]++;
  const classifierStats = new Map<
    string,
    { classifierId: string; category: string; files: number; matches: number }
  >();
  for (const s of scans) {
    for (const h of s.hits) {
      const c = classifierStats.get(h.classifierId) ?? {
        classifierId: h.classifierId,
        category: h.category,
        files: 0,
        matches: 0,
      };
      c.files++;
      c.matches += h.count;
      classifierStats.set(h.classifierId, c);
    }
  }
  const levels = [...policy.levels]
    .sort((a, b) => b.rank - a.rank)
    .map((l) => ({
      levelId: l.id,
      name: l.name,
      rank: l.rank,
      color: l.color ?? null,
      files: files.filter((f) => f.classification.level.id === l.id).length,
      breachingFiles: files.filter(
        (f) => f.classification.level.id === l.id && f.breaches.length > 0,
      ).length,
    }));
  const scanned = scans.filter((s) => s.status === 'scanned');
  const metrics: ContentMetrics = {
    policyName: policy.name,
    policyVersion: policy.version,
    filesScanned: scanned.length,
    filesSkipped: scans.filter((s) => s.status === 'skipped').length,
    filesFailed: scans.filter((s) => s.status === 'failed').length,
    bytesScanned: scanned.reduce((s, x) => s + x.sizeBytes, 0),
    filesWithHits: scanned.filter((s) => s.hits.length > 0).length,
    classifiedFiles: files.filter((f) => f.classification.level.rank > defaultRank).length,
    breachingFiles: files.filter((f) => f.breaches.length > 0).length,
    breachesByType,
    levels,
    classifiers: [...classifierStats.values()].sort((a, b) => b.files - a.files),
    lastScanAt: scans.reduce<string | null>(
      (max, s) => (max === null || s.scannedAt > max ? s.scannedAt : max),
      null,
    ),
    snippetsStored: scans.some((s) => s.hits.some((h) => h.snippets.length > 0)),
  };

  return {
    policy,
    files,
    byLocation: new Map(files.map((f) => [f.location.externalId, f])),
    metrics,
  };
}

/** Content-free view rows for persistence (breaches dashboard, CSV export, report). */
export function toFileViews(index: ContentIndex, limit = 5000): ClassifiedFileView[] {
  const defaultRank = levelById(index.policy, index.policy.defaultLevel).rank;
  return index.files
    .filter((f) => f.classification.level.rank > defaultRank || f.breaches.length > 0)
    .slice(0, limit)
    .map((f) => ({
      locationExternalId: f.location.externalId,
      name: f.location.name,
      webUrl: f.location.webUrl,
      siteExternalId: f.site?.externalId ?? null,
      siteName: f.site?.name ?? null,
      department: f.facts.department,
      levelId: f.classification.level.id,
      levelName: f.classification.level.name,
      levelRank: f.classification.level.rank,
      classificationSource: f.classification.source,
      matchedRules: f.classification.matchedRules.map((m) => m.ruleId),
      classifiers: f.scan.hits.map((h) => ({
        classifierId: h.classifierId,
        count: h.count,
        distinctValues: h.distinctValues,
      })),
      label: f.labelName,
      exposure: {
        anyoneLinks: f.facts.anyoneLinks,
        organizationLinks: f.facts.organizationLinks,
        externalPrincipals: f.facts.externalPrincipals,
        publicSite: f.facts.publicSite,
        audienceSize: f.facts.audienceSize,
      },
      lastModifiedAt: f.location.lastModifiedAt,
      breaches: f.breaches.map((b) => ({ type: b.type, message: b.message })),
      snippets: f.scan.hits.flatMap((h) => h.snippets).slice(0, 4),
    }));
}
