/**
 * Microsoft Graph connector: SharePoint/OneDrive exposure + Microsoft 365 Copilot
 * adoption, via app-only (client credentials) READ-ONLY access.
 *
 * Sync pipeline (each step is metadata-only):
 *   1. Sensitivity label catalogue  (optional, beta API)
 *   2. Users + licences             (/users, /subscribedSkus)
 *   3. Copilot usage report         (/reports/getMicrosoft365CopilotUsageUserDetail)
 *   4. M365 groups -> site mapping  (visibility, labels, member & guest counts)
 *   5. Sites -> libraries           (/sites/getAllSites, /sites/{id}/drives)
 *   6. Per library delta query      (items; only SHARED, SENSITIVE-NAMED or
 *                                    CONTENT-CLASSIFIED items are kept)
 *   6b. Content scan (optional)     (/drives/{d}/items/{i}/content, in memory only,
 *                                    handed to ctx.contentScanner; see @aiv/content-scan)
 *   6c. File sensitivity label      (POST .../extractSensitivityLabels — a read
 *                                    action needing only Files.Read.All)
 *   7. Permissions for kept items   (/drives/{d}/items/{i}/permissions)
 *
 * Incremental sync: step 6 stores one `deltaLink` per drive in the cursor, so the
 * next run only receives changed items. Steps 1-5 are cheap and always re-read.
 * Content is re-downloaded only when a file's cTag (content version) changes.
 * If the per-run download cap is reached, that drive's deltaLink is NOT
 * advanced, so remaining files are picked up next run (unchanged ones skipped).
 */
import { z } from 'zod';
import {
  emptyBatch,
  type ContentLocation,
  type ContentScan,
  type NormalizedBatch,
  type SharingGrant,
} from '@aiv/core';
import type { Connector, ConnectorContext, ConnectorCursor, SyncResult } from '../types';
import { createLimiter, mapLimit } from '../util';
import { GraphClient, GraphError } from './client';
import { GRAPH_PERMISSIONS } from './permissions';
import {
  COPILOT_ASSET_ID,
  hasUniquePermissions,
  parseCopilotLicences,
  parseCopilotUsageRow,
  parseDrive,
  parseDriveItem,
  parsePermission,
  parseSensitivityLabel,
  parseSite,
  parseUser,
  type GraphCopilotUsageRow,
  type GraphDrive,
  type GraphDriveItem,
  type GraphGroup,
  type GraphPermission,
  type GraphSensitivityLabel,
  type GraphSite,
  type GraphSku,
  type GraphUser,
} from './parsers';

export const graphConfigSchema = z.object({
  /** Client's Entra directory (tenant) ID. Can also come from GRAPH_TENANT_ID. */
  entraTenantId: z.string().min(1).optional(),
  /** App registration (client) ID. Can also come from GRAPH_CLIENT_ID. */
  clientId: z.string().min(1).optional(),
  /** Include personal OneDrive sites (more data; often where oversharing hides). */
  includeOneDrive: z.boolean().default(false),
  /** Safety cap for pilots / very large tenants. */
  maxSites: z.number().int().positive().default(5000),
  /** Safety cap on items enumerated per library per run. */
  maxItemsPerDrive: z.number().int().positive().default(50_000),
  /** Parallel requests. Keep low (<= 8) to respect Graph throttling. */
  concurrency: z.number().int().min(1).max(16).default(4),
  /** Labels with Purview sensitivity >= this are treated as sensitive. */
  sensitiveLabelFromPriority: z.number().int().default(2),
  /** Copilot report period (report v2 periods; D28 ≈ one month). */
  copilotReportPeriod: z.enum(['D7', 'D28', 'D90', 'D180']).default('D28'),
  /**
   * Read the sensitivity label of files that the content scanner classified
   * (driveItem extractSensitivityLabels; Files.Read.All). Only used when content
   * scanning is enabled.
   */
  readFileLabels: z.boolean().default(true),
});
export type GraphConfig = z.infer<typeof graphConfigSchema>;

interface GraphCursor extends ConnectorCursor {
  /** driveId -> @odata.deltaLink from the previous run. */
  driveDeltaLinks: Record<string, string>;
  lastFullSyncAt: string | null;
}

function readCursor(c: ConnectorCursor | null): GraphCursor {
  const links = (c?.driveDeltaLinks ?? {}) as Record<string, string>;
  return { driveDeltaLinks: links, lastFullSyncAt: (c?.lastFullSyncAt as string | null) ?? null };
}

/** Build a GraphClient from config + secrets; throws a clear error when anything is missing. */
export function createGraphClient(ctx: ConnectorContext<GraphConfig>): GraphClient {
  const entraTenantId = ctx.config.entraTenantId ?? ctx.secrets.GRAPH_TENANT_ID;
  const clientId = ctx.config.clientId ?? ctx.secrets.GRAPH_CLIENT_ID;
  const clientSecret = ctx.secrets.GRAPH_CLIENT_SECRET;
  if (!entraTenantId || !clientId || !clientSecret) {
    throw new Error(
      'Microsoft Graph connector needs GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET (see docs/PILOT_SETUP.md).',
    );
  }
  return new GraphClient({ entraTenantId, clientId, clientSecret, fetchImpl: ctx.fetch });
}

/** Tolerate an optional call failing with 403/404 (permission not granted / feature absent). */
async function optional<T>(
  warnings: string[],
  what: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GraphError && [400, 403, 404].includes(err.status)) {
      warnings.push(`${what}: skipped (${err.status} ${err.code ?? ''}). ${err.message}`);
      return fallback;
    }
    throw err;
  }
}

const USER_SELECT =
  'id,displayName,mail,userPrincipalName,department,jobTitle,userType,accountEnabled,assignedLicenses';
const ITEM_SELECT =
  'id,name,webUrl,lastModifiedDateTime,parentReference,folder,file,size,cTag,shared,root,deleted';

export const microsoftGraphConnector: Connector<GraphConfig> = {
  id: 'microsoft-graph',
  displayName: 'Microsoft 365 (SharePoint, OneDrive & Copilot)',
  vendor: 'Microsoft',
  description:
    'Reads SharePoint/OneDrive sharing exposure, sensitivity labels, Microsoft 365 Copilot usage and licences via Microsoft Graph (read-only, app-only).',
  maturity: 'available',
  requiredPermissions: GRAPH_PERMISSIONS,
  secretEnvVars: ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET'],
  configSchema: graphConfigSchema as z.ZodType<GraphConfig>,

  async authenticate(ctx) {
    try {
      const client = createGraphClient(ctx);
      await client.getToken();
      // Probe one cheap call per required permission so the admin sees exactly what's missing.
      const probes: Array<[string, string, 'v1.0' | 'beta']> = [
        ['User.Read.All', '/users?$top=1&$select=id', 'v1.0'],
        ['Sites.Read.All', '/sites?search=*&$top=1&$select=id', 'v1.0'],
        ['Group.Read.All', '/groups?$top=1&$select=id', 'v1.0'],
        [
          'Reports.Read.All',
          "/reports/getMicrosoft365CopilotUserCountSummary(period='D7')?$format=application/json",
          'beta',
        ],
      ];
      const missing: string[] = [];
      for (const [perm, path, version] of probes) {
        try {
          await client.get(path, { version });
        } catch (err) {
          if (err instanceof GraphError && (err.status === 403 || err.status === 401))
            missing.push(perm);
          else throw err;
        }
      }
      return missing.length
        ? {
            ok: false,
            message: `Connected, but missing permissions: ${missing.join(', ')}`,
            missingPermissions: missing,
          }
        : {
            ok: true,
            message: 'Connected to Microsoft Graph with the required read-only permissions.',
          };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  async sync(ctx, sinceCursor): Promise<SyncResult> {
    const config = graphConfigSchema.parse(ctx.config ?? {});
    const client = createGraphClient({ ...ctx, config });
    const cursor = readCursor(sinceCursor);
    const fullSync = Object.keys(cursor.driveDeltaLinks).length === 0;
    const warnings: string[] = [];
    const batch: NormalizedBatch = emptyBatch();
    const deletions = { locations: [] as string[], grants: [] as string[] };
    const now = (ctx.now ?? (() => new Date()))();

    // 1. Sensitivity label catalogue (optional).
    const rawLabels = await optional(
      warnings,
      'Sensitivity labels (InformationProtectionPolicy.Read.All)',
      () =>
        client.list<GraphSensitivityLabel>('/security/informationProtection/sensitivityLabels', {
          version: 'beta',
        }),
      [],
    );
    batch.labels = rawLabels.map((l) =>
      parseSensitivityLabel(l, config.sensitiveLabelFromPriority),
    );

    // 2. Users (+ sign-in activity if AuditLog.Read.All granted) and Copilot licences.
    let rawUsers = await optional(
      warnings,
      'Sign-in activity (AuditLog.Read.All / Entra ID P1)',
      () => client.list<GraphUser>(`/users?$select=${USER_SELECT},signInActivity&$top=999`),
      [] as GraphUser[],
    );
    if (rawUsers.length === 0)
      rawUsers = await client.list<GraphUser>(`/users?$select=${USER_SELECT}&$top=999`);
    batch.identities = rawUsers.map(parseUser);
    const guestIds = new Set(batch.identities.filter((i) => i.isGuest).map((i) => i.externalId));
    const deptNames = new Set(
      batch.identities.map((i) => i.departmentName).filter((d): d is string => Boolean(d)),
    );
    batch.departments = [...deptNames].map((name) => ({ externalId: name, name }));

    const skus = await client.list<GraphSku>('/subscribedSkus?$select=skuId,skuPartNumber');
    batch.licences = parseCopilotLicences(rawUsers, skus);
    batch.assets.push({
      externalId: COPILOT_ASSET_ID,
      name: 'Microsoft 365 Copilot',
      vendor: 'Microsoft',
      kind: 'copilot',
      groundedOnOrgData: true,
    });

    // 3. Copilot usage report. The beta endpoint returns JSON (v1.0 returns CSV).
    //    Current path: /copilot/reports/... (report v2). Older tenants/docs use
    //    /reports/...(period='D30'); fall back to it if the new path is unavailable.
    const upnToId = new Map(
      rawUsers
        .filter((u) => u.userPrincipalName)
        .map((u) => [u.userPrincipalName!.toLowerCase(), u.id]),
    );
    const periodDays = Number(config.copilotReportPeriod.slice(1));
    const reportWarnings: string[] = [];
    let usageRows = await optional(
      reportWarnings,
      'Copilot usage report (Reports.Read.All)',
      () =>
        client.list<GraphCopilotUsageRow>(
          `/copilot/reports/getMicrosoft365CopilotUsageUserDetail(period='${config.copilotReportPeriod}')`,
          { version: 'beta' },
        ),
      null as GraphCopilotUsageRow[] | null,
    );
    if (usageRows === null) {
      usageRows = await optional(
        warnings,
        'Copilot usage report (Reports.Read.All)',
        () =>
          client.list<GraphCopilotUsageRow>(
            "/reports/getMicrosoft365CopilotUsageUserDetail(period='D30')?$format=application/json",
            { version: 'beta' },
          ),
        [],
      );
    }
    let unmatched = 0;
    for (const row of usageRows) {
      const parsed = parseCopilotUsageRow(row, upnToId, periodDays);
      if (parsed) batch.usage.push(parsed);
      else unmatched++;
    }
    if (unmatched > 0 && unmatched === usageRows.length) {
      warnings.push(
        'Copilot usage rows could not be matched to users. The tenant probably conceals user names in reports — see PILOT_SETUP.md step 6.',
      );
    }

    // 4. M365 groups (Teams/group-connected sites): visibility, label, membership.
    const groups = await client.list<GraphGroup>(
      "/groups?$filter=groupTypes/any(c:c eq 'Unified')&$select=id,displayName,visibility,assignedLabels&$top=999",
    );
    const siteToGroup = new Map<
      string,
      GraphGroup & { memberCount: number | null; guestCount: number | null }
    >();
    await mapLimit(groups, config.concurrency, async (g) => {
      const site = await optional(
        warnings,
        `Group site ${g.id}`,
        () => client.get<{ id: string }>(`/groups/${g.id}/sites/root?$select=id`),
        null,
      );
      if (!site) return;
      const count = (path: string) =>
        optional(
          warnings,
          `Member count ${g.id}`,
          () => client.get<string | number>(path, { headers: { ConsistencyLevel: 'eventual' } }),
          null,
        );
      const members = await count(`/groups/${g.id}/members/$count`);
      const guests = await count(
        `/groups/${g.id}/members/microsoft.graph.user/$count?$filter=userType eq 'Guest'`,
      );
      siteToGroup.set(site.id, {
        ...g,
        memberCount: members === null ? null : Number(members),
        guestCount: guests === null ? null : Number(guests),
      });
    });

    // 5. Sites and their document libraries.
    const sites = (
      await client.list<GraphSite>(
        '/sites/getAllSites?$select=id,name,displayName,webUrl,lastModifiedDateTime,isPersonalSite&$top=999',
        {
          maxItems: config.maxSites,
        },
      )
    ).filter((s) => config.includeOneDrive || !s.isPersonalSite);
    batch.locations.push(...sites.map((s) => parseSite(s, siteToGroup.get(s.id))));

    const nextLinks: Record<string, string> = { ...cursor.driveDeltaLinks };
    let itemsScanned = 0;
    let permissionCalls = 0;

    // Content scanning state (only when the pipeline provided a scanner).
    const scanner = ctx.contentScanner;
    const known = ctx.knownContentVersions;
    const download = createLimiter(scanner?.settings.concurrency ?? 1);
    const maxBytes = (scanner?.settings.maxFileSizeMb ?? 0) * 1024 * 1024;
    let downloadBudget = scanner?.settings.maxFilesPerRun ?? 0;
    const scanStats = {
      filesDownloaded: 0,
      bytesScanned: 0,
      filesUnchanged: 0,
      filesNotInAllowList: 0,
      filesSkipped: 0,
      filesFailed: 0,
      filesWithHits: 0,
      labelCalls: 0,
    };
    let capReached = false;
    const seenFileIds: string[] = [];
    const deletedFileIds: string[] = [];
    const labelWarnings = new Set<string>();

    /** Download + scan one file. Returns the scan (or null when unchanged / not applicable). */
    const scanFile = async (
      item: GraphDriveItem,
      driveId: string,
      siteId: string,
      name: string,
    ): Promise<{ scan: ContentScan | null; unchangedWithHits: boolean; deferred: boolean }> => {
      if (!scanner || !item.file) return { scan: null, unchangedWithHits: false, deferred: false };
      const target = {
        locationExternalId: item.id,
        siteExternalId: siteId,
        name,
        sizeBytes: item.size ?? 0,
        sourceVersion: item.cTag ?? null,
      };
      const reason = scanner.skipReason(target);
      if (reason) {
        if (reason.startsWith('file type')) {
          scanStats.filesNotInAllowList++;
          return { scan: null, unchangedWithHits: false, deferred: false };
        }
        scanStats.filesSkipped++;
        return { scan: scanner.skipped(target, reason), unchangedWithHits: false, deferred: false };
      }
      const prev = known?.get(item.id);
      if (prev && target.sourceVersion && prev.version === target.sourceVersion) {
        scanStats.filesUnchanged++;
        return { scan: null, unchangedWithHits: prev.hadHits, deferred: false };
      }
      if (downloadBudget <= 0) {
        capReached = true;
        return { scan: null, unchangedWithHits: false, deferred: true };
      }
      downloadBudget--;
      return download(async () => {
        let bytes: Uint8Array;
        try {
          bytes = await client.getBytes(`/drives/${driveId}/items/${item.id}/content`, maxBytes);
        } catch (err) {
          scanStats.filesFailed++;
          const status =
            err instanceof GraphError ? `${err.status} ${err.code ?? ''}`.trim() : 'error';
          return {
            scan: { ...scanner.skipped(target, `download failed (${status})`), status: 'failed' },
            unchangedWithHits: false,
            deferred: false,
          };
        }
        scanStats.filesDownloaded++;
        scanStats.bytesScanned += bytes.byteLength;
        const scan = await scanner.scan(target, bytes); // zero-fills `bytes`
        if (scan.status === 'failed') scanStats.filesFailed++;
        if (scan.hits.length) scanStats.filesWithHits++;
        return { scan, unchangedWithHits: false, deferred: false };
      });
    };

    /** Applied label of a classified file (best effort; see PILOT_SETUP for limits). */
    const fileLabel = async (driveId: string, itemId: string): Promise<string | null> => {
      scanStats.labelCalls++;
      try {
        const res = await client.postAction<{
          value?: { labels?: Array<{ sensitivityLabelId?: string }> };
          labels?: Array<{ sensitivityLabelId?: string }>;
        }>(`/drives/${driveId}/items/${itemId}/extractSensitivityLabels`);
        const labels = res.value?.labels ?? res.labels ?? [];
        return labels[0]?.sensitivityLabelId ?? null;
      } catch (err) {
        if (err instanceof GraphError && [400, 403, 404, 423].includes(err.status)) {
          labelWarnings.add(`${err.status} ${err.code ?? ''}`.trim());
          return null;
        }
        throw err;
      }
    };

    await mapLimit(sites, config.concurrency, async (site) => {
      const drives = await optional(
        warnings,
        `Libraries of ${site.webUrl ?? site.id}`,
        () =>
          client.list<GraphDrive>(
            `/sites/${site.id}/drives?$select=id,name,webUrl,driveType,lastModifiedDateTime`,
          ),
        [],
      );
      for (const drive of drives) {
        batch.locations.push(parseDrive(drive, site.id));

        // 6. Delta enumeration of the library (incremental when we have a deltaLink).
        const previousLink = cursor.driveDeltaLinks[drive.id];
        const start = previousLink ?? `/drives/${drive.id}/root/delta?$select=${ITEM_SELECT}`;
        const { items, deltaLink, truncated } = await client.delta<GraphDriveItem>(start, {
          // hierarchicalsharing makes Graph report sharing changes on the item where they happen.
          headers: {
            Prefer: 'hierarchicalsharing, deltashowremovedasdeleted, deltatraversepermissiongaps',
          },
          maxItems: config.maxItemsPerDrive,
        });
        if (truncated)
          warnings.push(
            `Library ${drive.name ?? drive.id} truncated at ${config.maxItemsPerDrive} items.`,
          );
        itemsScanned += items.length;
        let driveDeferred = false;

        await mapLimit(items, scanner ? scanner.settings.concurrency : 1, async (item) => {
          if (item.deleted) {
            deletions.locations.push(item.id);
            deletedFileIds.push(item.id);
            return;
          }
          if (item.root) return;
          const loc = parseDriveItem(item, drive.id, site.id);
          if (item.file && fullSync) seenFileIds.push(item.id);

          // 6b. Content scan.
          const { scan, unchangedWithHits, deferred } = await scanFile(
            item,
            drive.id,
            site.id,
            loc.name,
          );
          if (deferred) driveDeferred = true;
          if (scan) batch.contentScans.push(scan);
          const classified = unchangedWithHits || Boolean(scan?.hits.length);

          // Data minimisation: only keep items that are shared, look sensitive, or hold sensitive content.
          if (!item.shared && !loc.likelySensitive && !classified) {
            // Incremental: a previously kept item may no longer qualify; drop its stale row.
            if (!fullSync) deletions.locations.push(item.id);
            return;
          }

          // 6c. File-level sensitivity label for classified content.
          if (classified && config.readFileLabels)
            loc.sensitivityLabelId = await fileLabel(drive.id, item.id);

          // 7. Permissions for kept items.
          let grants: SharingGrant[] = [];
          if (item.shared) {
            permissionCalls++;
            const perms = await optional(
              warnings,
              `Permissions of item ${item.id}`,
              () =>
                client.list<GraphPermission>(`/drives/${drive.id}/items/${item.id}/permissions`),
              [],
            );
            grants = perms.map((p) => parsePermission(p, item.id, guestIds));
          }
          const withFlag: ContentLocation = {
            ...loc,
            hasUniquePermissions: hasUniquePermissions(grants),
          };
          batch.locations.push(withFlag);
          batch.grants.push(...grants);
        });

        // Advance the cursor only when every file in this drive was handled.
        if (deltaLink && !driveDeferred) nextLinks[drive.id] = deltaLink;
        else if (!deltaLink) delete nextLinks[drive.id];
        else if (!previousLink) delete nextLinks[drive.id];
      }
    });
    if (capReached && scanner)
      warnings.push(
        `Content scan reached the per-run cap (${scanner.settings.maxFilesPerRun} files); remaining files will be scanned on the next run.`,
      );
    if (labelWarnings.size)
      warnings.push(
        `File sensitivity labels could not be read for some files (${[...labelWarnings].join(', ')}); label checks fall back to library/site labels.`,
      );

    // Roll up guest presence on sites into explicit grants so rules treat them uniformly.
    for (const loc of batch.locations) {
      if ((loc.kind === 'site' || loc.kind === 'team') && (loc.guestMemberCount ?? 0) > 0) {
        batch.grants.push({
          externalId: `${loc.externalId}:guest-members`,
          locationExternalId: loc.externalId,
          scope: 'external-guest',
          roles: ['member'],
          grantedToExternalIds: [],
          externalPrincipalCount: loc.guestMemberCount ?? 0,
          createdAt: null,
          expiresAt: null,
          inherited: false,
        });
      }
    }

    return {
      batch,
      nextCursor: {
        driveDeltaLinks: nextLinks,
        lastFullSyncAt: fullSync ? now.toISOString() : cursor.lastFullSyncAt,
      },
      fullSync,
      deletions,
      contentScanScope: scanner
        ? { fullEnumeration: fullSync, seenFileIds, deletedFileIds }
        : undefined,
      stats: {
        ...(scanner ? scanStats : {}),
        users: batch.identities.length,
        sites: sites.length,
        locations: batch.locations.length,
        grants: batch.grants.length,
        itemsScanned,
        permissionCalls,
        graphRequests: client.requestCount,
        throttled: client.throttleCount,
      },
      warnings,
    };
  },
};
