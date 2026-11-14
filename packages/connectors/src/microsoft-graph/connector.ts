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
 *   6. Per library delta query      (items; only SHARED or SENSITIVE-NAMED items are kept)
 *   7. Permissions for kept items   (/drives/{d}/items/{i}/permissions)
 *
 * Incremental sync: step 6 stores one `deltaLink` per drive in the cursor, so the
 * next run only receives changed items. Steps 1-5 are cheap and always re-read.
 */
import { z } from 'zod';
import {
  emptyBatch,
  type ContentLocation,
  type NormalizedBatch,
  type SharingGrant,
} from '@aiv/core';
import type { Connector, ConnectorContext, ConnectorCursor, SyncResult } from '../types';
import { mapLimit } from '../util';
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
  /** Copilot report period. */
  copilotReportPeriod: z.enum(['D7', 'D30', 'D90', 'D180']).default('D30'),
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
  'id,name,webUrl,lastModifiedDateTime,parentReference,folder,file,shared,root,deleted';

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

    // 3. Copilot usage report. Beta endpoint; JSON format requested explicitly.
    const upnToId = new Map(
      rawUsers
        .filter((u) => u.userPrincipalName)
        .map((u) => [u.userPrincipalName!.toLowerCase(), u.id]),
    );
    const periodDays = Number(config.copilotReportPeriod.slice(1));
    const usageRows = await optional(
      warnings,
      'Copilot usage report (Reports.Read.All)',
      () =>
        client.list<GraphCopilotUsageRow>(
          `/reports/getMicrosoft365CopilotUsageUserDetail(period='${config.copilotReportPeriod}')?$format=application/json`,
          { version: 'beta' },
        ),
      [],
    );
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
        const start =
          cursor.driveDeltaLinks[drive.id] ??
          `/drives/${drive.id}/root/delta?$select=${ITEM_SELECT}`;
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
        if (deltaLink) nextLinks[drive.id] = deltaLink;
        else delete nextLinks[drive.id];
        itemsScanned += items.length;

        for (const item of items) {
          if (item.deleted) {
            deletions.locations.push(item.id);
            continue;
          }
          if (item.root) continue;
          const loc = parseDriveItem(item, drive.id, site.id);
          // Data minimisation: only keep items that are shared or look sensitive.
          if (!item.shared && !loc.likelySensitive) continue;

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
        }
      }
    });

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
      stats: {
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
