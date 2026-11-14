/**
 * Persist and load normalized entities.
 *
 * Write strategy (simple, portable across Postgres/SQLite):
 *  - FULL sync: delete all rows of this connector instance, then insert.
 *  - INCREMENTAL sync: for locations/grants, delete rows whose externalId is in
 *    the batch or in `deletions`, then insert the batch rows. Directory-type
 *    data (users, licences, usage, labels, costs) is always re-read in full by
 *    connectors, so it is replaced.
 *  - CONTENT SCANS are NOT cleared by a full sync (re-reading every file is
 *    expensive): rows are upserted per file, removed for deleted files, and
 *    orphans are removed after a full enumeration (`contentScanScope`).
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { ClassifierHit, ContentScan, NormalizedBatch } from '@aiv/core';

export interface ContentScanScope {
  /** True when every drive was enumerated in full → rows not in seenFileIds are orphans. */
  fullEnumeration: boolean;
  seenFileIds: string[];
  deletedFileIds: string[];
}

const CHUNK = 500;
function chunks<T>(xs: readonly T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

type Tx = Prisma.TransactionClient | PrismaClient;
const d = (iso: string | null | undefined) => (iso ? new Date(iso) : null);
const iso = (date: Date | null) => (date ? date.toISOString() : null);
const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function saveBatch(
  db: PrismaClient,
  scope: { tenantId: string; connectorInstanceId: string },
  batch: NormalizedBatch,
  opts: {
    fullSync: boolean;
    deletions?: { locations: string[]; grants: string[] };
    contentScanScope?: ContentScanScope;
  },
): Promise<void> {
  const where = { tenantId: scope.tenantId, connectorInstanceId: scope.connectorInstanceId };
  const base = { tenantId: scope.tenantId, connectorInstanceId: scope.connectorInstanceId };

  await db.$transaction(
    async (tx: Tx) => {
      // Directory-type data: always replaced.
      await tx.department.deleteMany({ where });
      await tx.identity.deleteMany({ where });
      await tx.aIAsset.deleteMany({ where });
      await tx.licence.deleteMany({ where });
      await tx.usageSummary.deleteMany({ where });
      await tx.sensitivityLabel.deleteMany({ where });
      await tx.costItem.deleteMany({ where });

      if (opts.fullSync) {
        await tx.contentLocation.deleteMany({ where });
        await tx.sharingGrant.deleteMany({ where });
      } else {
        const locIds = [
          ...batch.locations.map((l) => l.externalId),
          ...(opts.deletions?.locations ?? []),
        ];
        const grantIds = [
          ...batch.grants.map((g) => g.externalId),
          ...(opts.deletions?.grants ?? []),
        ];
        await tx.contentLocation.deleteMany({ where: { ...where, externalId: { in: locIds } } });
        await tx.sharingGrant.deleteMany({ where: { ...where, externalId: { in: grantIds } } });
        // Grants on locations that changed are re-emitted by the connector; drop stale ones.
        await tx.sharingGrant.deleteMany({
          where: { ...where, locationExternalId: { in: locIds } },
        });
      }

      await tx.department.createMany({
        data: batch.departments.map((x) => ({ ...base, externalId: x.externalId, name: x.name })),
      });
      await tx.identity.createMany({
        data: batch.identities.map((x) => ({ ...base, ...x, lastSignInAt: d(x.lastSignInAt) })),
      });
      await tx.aIAsset.createMany({ data: batch.assets.map((x) => ({ ...base, ...x })) });
      await tx.licence.createMany({
        data: batch.licences.map((x) => ({ ...base, ...x, assignedAt: d(x.assignedAt) })),
      });
      await tx.usageSummary.createMany({
        data: batch.usage.map((x) => ({
          ...base,
          ...x,
          periodStart: new Date(x.periodStart),
          periodEnd: new Date(x.periodEnd),
          lastActivityAt: d(x.lastActivityAt),
          featureLastActivity: json(x.featureLastActivity),
        })),
      });
      await tx.sensitivityLabel.createMany({ data: batch.labels.map((x) => ({ ...base, ...x })) });
      await tx.costItem.createMany({ data: batch.costs.map((x) => ({ ...base, ...x })) });
      // De-duplicate within the batch (a connector may emit the same item twice across drives).
      const locs = [...new Map(batch.locations.map((l) => [l.externalId, l])).values()];
      await tx.contentLocation.createMany({
        data: locs.map((x) => ({
          ...base,
          ...x,
          lastModifiedAt: d(x.lastModifiedAt),
          sensitivityReasons: json(x.sensitivityReasons),
        })),
      });
      const grants = [...new Map(batch.grants.map((g) => [g.externalId, g])).values()];
      await tx.sharingGrant.createMany({
        data: grants.map((x) => ({
          ...base,
          ...x,
          roles: json(x.roles),
          grantedToExternalIds: json(x.grantedToExternalIds),
          createdAt: d(x.createdAt),
          expiresAt: d(x.expiresAt),
        })),
      });

      // Content scans: replace rows for files in this batch / deleted files.
      const scans = [...new Map(batch.contentScans.map((c) => [c.locationExternalId, c])).values()];
      const replaced = [
        ...scans.map((c) => c.locationExternalId),
        ...(opts.contentScanScope?.deletedFileIds ?? []),
      ];
      for (const ids of chunks(replaced)) {
        await tx.contentScan.deleteMany({ where: { ...where, locationExternalId: { in: ids } } });
      }
      for (const part of chunks(scans)) {
        await tx.contentScan.createMany({
          data: part.map((x) => ({
            ...base,
            locationExternalId: x.locationExternalId,
            siteExternalId: x.siteExternalId,
            extension: x.extension,
            sizeBytes: x.sizeBytes,
            contentSha256: x.contentSha256,
            sourceVersion: x.sourceVersion,
            scannedAt: new Date(x.scannedAt),
            status: x.status,
            statusReason: x.statusReason,
            textChars: x.textChars,
            hitCount: x.hits.reduce((n, h) => n + h.count, 0),
            hits: json(x.hits),
            llm: x.llm ? json(x.llm) : undefined,
          })),
        });
      }
    },
    { timeout: 300_000, maxWait: 20_000 },
  );

  // Orphans: files that no longer exist (only knowable after a full enumeration).
  const scanScope = opts.contentScanScope;
  if (scanScope?.fullEnumeration) {
    const seen = new Set(scanScope.seenFileIds);
    for (const s of batch.contentScans) seen.add(s.locationExternalId);
    const existing = await db.contentScan.findMany({ where, select: { locationExternalId: true } });
    const orphans = existing.map((e) => e.locationExternalId).filter((id) => !seen.has(id));
    for (const ids of chunks(orphans)) {
      await db.contentScan.deleteMany({ where: { ...where, locationExternalId: { in: ids } } });
    }
  }
}

/** File → last scanned version, so connectors can skip unchanged files. */
export async function loadKnownContentVersions(
  db: PrismaClient,
  scope: { tenantId: string; connectorInstanceId: string },
): Promise<Map<string, { version: string; hadHits: boolean }>> {
  const rows = await db.contentScan.findMany({
    where: { ...scope, status: { not: 'failed' }, sourceVersion: { not: null } },
    select: { locationExternalId: true, sourceVersion: true, hitCount: true },
  });
  return new Map(
    rows.map((r) => [r.locationExternalId, { version: r.sourceVersion!, hadHits: r.hitCount > 0 }]),
  );
}

/** Load every normalized entity for a tenant (all connector instances) as one batch. */
export async function loadBatch(db: PrismaClient, tenantId: string): Promise<NormalizedBatch> {
  const where = { tenantId };
  const [
    departments,
    identities,
    assets,
    licences,
    usage,
    locations,
    grants,
    labels,
    costs,
    contentScans,
  ] = await Promise.all([
    db.department.findMany({ where }),
    db.identity.findMany({ where }),
    db.aIAsset.findMany({ where }),
    db.licence.findMany({ where }),
    db.usageSummary.findMany({ where }),
    db.contentLocation.findMany({ where }),
    db.sharingGrant.findMany({ where }),
    db.sensitivityLabel.findMany({ where }),
    db.costItem.findMany({ where }),
    db.contentScan.findMany({ where }),
  ]);
  return {
    departments: departments.map((x) => ({ externalId: x.externalId, name: x.name })),
    identities: identities.map((x) => ({
      externalId: x.externalId,
      displayName: x.displayName,
      email: x.email,
      departmentName: x.departmentName,
      jobTitle: x.jobTitle,
      isGuest: x.isGuest,
      accountEnabled: x.accountEnabled,
      lastSignInAt: iso(x.lastSignInAt),
    })),
    assets: assets.map((x) => ({
      externalId: x.externalId,
      name: x.name,
      vendor: x.vendor,
      kind: x.kind as NormalizedBatch['assets'][number]['kind'],
      groundedOnOrgData: x.groundedOnOrgData,
    })),
    licences: licences.map((x) => ({
      identityExternalId: x.identityExternalId,
      assetExternalId: x.assetExternalId,
      skuId: x.skuId,
      skuName: x.skuName,
      assignedAt: iso(x.assignedAt),
    })),
    usage: usage.map((x) => ({
      identityExternalId: x.identityExternalId,
      assetExternalId: x.assetExternalId,
      periodStart: x.periodStart.toISOString(),
      periodEnd: x.periodEnd.toISOString(),
      lastActivityAt: iso(x.lastActivityAt),
      activeDays: x.activeDays,
      featureLastActivity: x.featureLastActivity as Record<string, string | null>,
    })),
    locations: locations.map((x) => ({
      externalId: x.externalId,
      parentExternalId: x.parentExternalId,
      kind: x.kind as NormalizedBatch['locations'][number]['kind'],
      name: x.name,
      webUrl: x.webUrl,
      siteExternalId: x.siteExternalId,
      ownerDepartment: x.ownerDepartment,
      visibility: x.visibility as 'public' | 'private' | 'unknown',
      memberCount: x.memberCount,
      guestMemberCount: x.guestMemberCount,
      itemCount: x.itemCount,
      lastModifiedAt: iso(x.lastModifiedAt),
      sensitivityLabelId: x.sensitivityLabelId,
      hasUniquePermissions: x.hasUniquePermissions,
      likelySensitive: x.likelySensitive,
      sensitivityReasons: x.sensitivityReasons as string[],
    })),
    grants: grants.map((x) => ({
      externalId: x.externalId,
      locationExternalId: x.locationExternalId,
      scope: x.scope as NormalizedBatch['grants'][number]['scope'],
      roles: x.roles as string[],
      grantedToExternalIds: x.grantedToExternalIds as string[],
      externalPrincipalCount: x.externalPrincipalCount,
      createdAt: iso(x.createdAt),
      expiresAt: iso(x.expiresAt),
      inherited: x.inherited,
    })),
    labels: labels.map((x) => ({
      externalId: x.externalId,
      name: x.name,
      priority: x.priority,
      isSensitive: x.isSensitive,
    })),
    costs: costs.map((x) => ({
      externalId: x.externalId,
      assetExternalId: x.assetExternalId,
      category: x.category as NormalizedBatch['costs'][number]['category'],
      description: x.description,
      monthlyAmount: x.monthlyAmount,
      currency: x.currency,
    })),
    contentScans: contentScans.map((x): ContentScan => ({
      locationExternalId: x.locationExternalId,
      siteExternalId: x.siteExternalId,
      extension: x.extension,
      sizeBytes: x.sizeBytes,
      contentSha256: x.contentSha256,
      sourceVersion: x.sourceVersion,
      scannedAt: x.scannedAt.toISOString(),
      status: x.status as ContentScan['status'],
      statusReason: x.statusReason,
      textChars: x.textChars,
      hits: x.hits as unknown as ClassifierHit[],
      llm: (x.llm as unknown as ContentScan['llm']) ?? null,
    })),
  };
}

/**
 * Delete a tenant and ALL its data. Entity tables are intentionally not
 * FK-linked to Tenant (keeps bulk writes simple and fast), so they are cleared
 * explicitly here. Used for offboarding and for re-seeding the demo.
 */
export async function deleteTenant(db: PrismaClient, tenantId: string): Promise<void> {
  const where = { tenantId };
  await db.$transaction([
    db.department.deleteMany({ where }),
    db.identity.deleteMany({ where }),
    db.aIAsset.deleteMany({ where }),
    db.licence.deleteMany({ where }),
    db.usageSummary.deleteMany({ where }),
    db.contentLocation.deleteMany({ where }),
    db.sharingGrant.deleteMany({ where }),
    db.sensitivityLabel.deleteMany({ where }),
    db.costItem.deleteMany({ where }),
    db.contentScan.deleteMany({ where }),
    db.policyDraft.deleteMany({ where }),
    db.auditEvent.deleteMany({ where }),
    db.vendorAccessGrant.deleteMany({ where }),
    db.remediationTask.deleteMany({ where }),
    db.syncRun.deleteMany({ where }),
    db.tenant.delete({ where: { id: tenantId } }),
  ]);
}
