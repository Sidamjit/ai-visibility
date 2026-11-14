/**
 * Tiny builders for analysis tests: create a NormalizedBatch with sensible
 * defaults so each test states only what matters for the rule under test.
 */
import {
  emptyBatch,
  type ClassifierHit,
  type ContentScan,
  type ContentLocation,
  type NormalizedBatch,
  type SharingGrant,
} from '@aiv/core';

export const AS_OF = new Date('2026-11-14T00:00:00Z');
export const daysAgo = (n: number) => new Date(AS_OF.getTime() - n * 86_400_000).toISOString();

export function site(id: string, over: Partial<ContentLocation> = {}): ContentLocation {
  return {
    externalId: id,
    parentExternalId: null,
    kind: 'site',
    name: `Site ${id}`,
    webUrl: null,
    siteExternalId: id,
    ownerDepartment: 'Finance',
    visibility: 'private',
    memberCount: 10,
    guestMemberCount: 0,
    itemCount: 10,
    lastModifiedAt: daysAgo(5),
    sensitivityLabelId: null,
    hasUniquePermissions: false,
    likelySensitive: false,
    sensitivityReasons: [],
    ...over,
  };
}

export function item(
  id: string,
  siteId: string,
  over: Partial<ContentLocation> = {},
): ContentLocation {
  return site(id, {
    parentExternalId: siteId,
    siteExternalId: siteId,
    kind: 'file',
    name: `${id}.docx`,
    memberCount: null,
    ...over,
  });
}

export const sensitive = {
  likelySensitive: true,
  sensitivityReasons: ['payroll / salary'],
  name: 'Payroll.xlsx',
};

export function grant(
  locationId: string,
  scope: SharingGrant['scope'],
  over: Partial<SharingGrant> = {},
): SharingGrant {
  return {
    externalId: `${locationId}:${scope}:${Math.random()}`,
    locationExternalId: locationId,
    scope,
    roles: ['read'],
    grantedToExternalIds: [],
    externalPrincipalCount: scope === 'external-guest' ? 1 : 0,
    createdAt: null,
    expiresAt: null,
    inherited: false,
    ...over,
  };
}

export function withPeople(
  b: NormalizedBatch,
  dept: string,
  people: Array<{
    licensed: boolean;
    lastActiveDaysAgo: number | null;
    activeDays?: number;
    apps?: string[];
    enabled?: boolean;
  }>,
): NormalizedBatch {
  people.forEach((p, i) => {
    const id = `${dept}-${i}`;
    b.identities.push({
      externalId: id,
      displayName: id,
      email: `${id}@x.test`,
      departmentName: dept,
      jobTitle: null,
      isGuest: false,
      accountEnabled: p.enabled ?? true,
      lastSignInAt: daysAgo(1),
    });
    if (!p.licensed) return;
    b.licences.push({
      identityExternalId: id,
      assetExternalId: 'm365-copilot',
      skuId: 'sku',
      skuName: 'Microsoft_365_Copilot',
      assignedAt: null,
    });
    const features: Record<string, string | null> = {
      teams: null,
      outlook: null,
      word: null,
      excel: null,
      powerpoint: null,
      chat: null,
      loop: null,
      onenote: null,
    };
    for (const app of p.apps ?? []) features[app] = daysAgo(1);
    b.usage.push({
      identityExternalId: id,
      assetExternalId: 'm365-copilot',
      periodStart: daysAgo(30),
      periodEnd: daysAgo(0),
      lastActivityAt: p.lastActiveDaysAgo === null ? null : daysAgo(p.lastActiveDaysAgo),
      activeDays:
        p.activeDays ?? (p.lastActiveDaysAgo !== null && p.lastActiveDaysAgo <= 30 ? 8 : 0),
      featureLastActivity: features,
    });
  });
  return b;
}

export function batch(over: Partial<NormalizedBatch> = {}): NormalizedBatch {
  return {
    ...emptyBatch(),
    labels: [
      { externalId: 'lbl-general', name: 'General', priority: 1, isSensitive: false },
      { externalId: 'lbl-conf', name: 'Confidential', priority: 2, isSensitive: true },
    ],
    ...over,
  };
}

/** A content-scan result for a file, with hits given as [classifierId, count, distinct?]. */
export function scan(
  locationId: string,
  siteId: string,
  hits: Array<[string, number, number?]>,
  over: Partial<ContentScan> = {},
): ContentScan {
  return {
    locationExternalId: locationId,
    siteExternalId: siteId,
    extension: 'xlsx',
    sizeBytes: 1000,
    contentSha256: 'a'.repeat(64),
    sourceVersion: 'c1',
    scannedAt: daysAgo(0),
    status: 'scanned',
    statusReason: null,
    textChars: 500,
    hits: hits.map(([classifierId, count, distinct]): ClassifierHit => ({
      classifierId,
      category: 'government-id',
      count,
      distinctValues: distinct ?? count,
      confidence: 'high',
      snippets: [],
    })),
    llm: null,
    ...over,
  };
}
