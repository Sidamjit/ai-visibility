/**
 * Synthetic data generator for the demo connector.
 *
 * Produces a realistic, deterministic NormalizedBatch for "Harbourview Group"
 * so the whole product (analysis + dashboards) works without a real tenant.
 *
 * `remediationProgress` (0..1) simulates the organisation fixing issues over
 * time; the worker uses it to build a believable score trend for the demo.
 */
import {
  emptyBatch,
  sensitiveNameReasons,
  type NormalizedBatch,
  type SharingGrant,
} from '@aiv/core';
import { createRandom } from './random';
import { COPILOT_APPS, DEMO_DEPARTMENTS, DEMO_SITES, FIRST_NAMES, LAST_NAMES } from './org';

export interface DemoOptions {
  seed?: number;
  /** "Now" for the generated data. */
  asOf?: Date;
  /** 0 = today's messy state, 1 = everything fixed. */
  remediationProgress?: number;
}

const DAY = 86_400_000;
const COPILOT = 'm365-copilot';
const COPILOT_SKU = '639dec6b-bb19-468b-871c-c5c441c4b0cb';

export function generateDemoBatch(opts: DemoOptions = {}): NormalizedBatch {
  const seed = opts.seed ?? 42;
  const asOf = opts.asOf ?? new Date();
  const progress = Math.min(1, Math.max(0, opts.remediationProgress ?? 0));
  const rng = createRandom(seed);
  const iso = (msAgo: number) => new Date(asOf.getTime() - msAgo).toISOString();
  const b = emptyBatch();

  b.labels = [
    { externalId: 'lbl-public', name: 'Public', priority: 0, isSensitive: false },
    { externalId: 'lbl-general', name: 'General', priority: 1, isSensitive: false },
    { externalId: 'lbl-confidential', name: 'Confidential', priority: 2, isSensitive: true },
    {
      externalId: 'lbl-highly-confidential',
      name: 'Highly Confidential',
      priority: 3,
      isSensitive: true,
    },
  ];

  b.assets = [
    {
      externalId: COPILOT,
      name: 'Microsoft 365 Copilot',
      vendor: 'Microsoft',
      kind: 'copilot',
      groundedOnOrgData: true,
    },
    {
      externalId: 'hr-policy-agent',
      name: 'HR Policy Assistant (Copilot Studio agent)',
      vendor: 'Microsoft',
      kind: 'agent',
      groundedOnOrgData: true,
    },
  ];
  b.costs = [
    {
      externalId: 'cost-copilot-studio',
      assetExternalId: 'hr-policy-agent',
      category: 'consumption',
      description: 'Copilot Studio message packs',
      monthlyAmount: 400,
      currency: 'USD',
    },
    {
      externalId: 'cost-azure-openai',
      assetExternalId: 'hr-policy-agent',
      category: 'consumption',
      description: 'Azure OpenAI tokens for HR agent',
      monthlyAmount: 1850,
      currency: 'USD',
    },
  ];

  // ---- People, licences and Copilot usage ----
  const periodEnd = iso(0);
  const periodStart = iso(30 * DAY);
  let n = 0;
  for (const dept of DEMO_DEPARTMENTS) {
    b.departments.push({ externalId: dept.name, name: dept.name });
    for (let i = 0; i < dept.headcount; i++) {
      n++;
      // Independent stream per person so changing `remediationProgress` only changes
      // the outcome of that person's rolls, not everyone generated after them.
      const ur = createRandom(seed * 1_000_003 + n);
      const first = rng.pick(FIRST_NAMES);
      const last = rng.pick(LAST_NAMES);
      const id = `user-${String(n).padStart(4, '0')}`;
      // ~2% are leavers whose accounts are disabled but still licensed.
      const leaver = ur.chance(0.02);
      b.identities.push({
        externalId: id,
        displayName: `${first} ${last}`,
        email:
          `${first}.${last}.${n}`.toLowerCase().replace(/[^a-z0-9.]/g, '') + '@harbourview.example',
        departmentName: dept.name,
        jobTitle: i === 0 ? `Head of ${dept.name}` : i < 4 ? 'Team Lead' : 'Specialist',
        isGuest: false,
        accountEnabled: !leaver,
        lastSignInAt: leaver ? iso(ur.int(60, 200) * DAY) : iso(ur.int(0, 5) * DAY),
      });

      const licensed = ur.next() < dept.licenceRate;
      const activeRoll = ur.next();
      const intensityRoll = ur.next();
      const breadthRoll = ur.int(dept.breadth[0], dept.breadth[1]);
      if (!licensed) continue;
      b.licences.push({
        identityExternalId: id,
        assetExternalId: COPILOT,
        skuId: COPILOT_SKU,
        skuName: 'Microsoft_365_Copilot',
        assignedAt: iso(ur.int(60, 300) * DAY),
      });

      const active = !leaver && activeRoll < Math.min(0.97, dept.activeRate + progress * 0.25);
      if (!active) {
        const never = ur.chance(0.4);
        b.usage.push({
          identityExternalId: id,
          assetExternalId: COPILOT,
          periodStart,
          periodEnd,
          lastActivityAt: never ? null : iso(ur.int(35, 150) * DAY),
          activeDays: 0,
          featureLastActivity: Object.fromEntries(COPILOT_APPS.map((a) => [a, null])),
        });
        continue;
      }
      const activeDays =
        intensityRoll < 0.35 ? ur.int(1, 4) : intensityRoll < 0.8 ? ur.int(5, 14) : ur.int(15, 22);
      const breadth = Math.min(COPILOT_APPS.length, breadthRoll + (progress > 0.5 ? 1 : 0));
      const features: Record<string, string | null> = {};
      COPILOT_APPS.forEach((app, idx) => {
        features[app] = idx < breadth ? iso(ur.int(0, Math.max(1, 30 - activeDays)) * DAY) : null;
      });
      b.usage.push({
        identityExternalId: id,
        assetExternalId: COPILOT,
        periodStart,
        periodEnd,
        lastActivityAt: iso(ur.int(0, 6) * DAY),
        activeDays,
        featureLastActivity: features,
      });
    }
  }
  // External guests (partners, contractors, old agency staff).
  for (let g = 1; g <= 46; g++) {
    b.identities.push({
      externalId: `guest-${g}`,
      displayName: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)} (Guest)`,
      email: `guest${g}@partner${(g % 7) + 1}.example`,
      departmentName: null,
      jobTitle: null,
      isGuest: true,
      accountEnabled: true,
      lastSignInAt: rng.chance(0.5) ? iso(rng.int(1, 30) * DAY) : iso(rng.int(200, 900) * DAY),
    });
  }

  // ---- SharePoint sites, libraries, folders/files and sharing ----
  DEMO_SITES.forEach((site, sIdx) => {
    const siteId = `site-${sIdx + 1}`;
    const sr = createRandom(seed * 7_919 + sIdx);
    const libId = `${siteId}-lib`;
    const modifiedMs = site.staleYears * 365 * DAY + sr.int(1, 40) * DAY;
    const siteReasons = sensitiveNameReasons(site.name);
    // Remediation: some public sites become private and labels get applied.
    // Always consume the roll so the random stream is identical for every progress value.
    const remediationRoll = sr.next();
    const remediated = remediationRoll < progress * 0.6;
    b.locations.push({
      externalId: siteId,
      parentExternalId: null,
      kind: site.visibility === 'public' || site.members > 100 ? 'team' : 'site',
      name: site.name,
      webUrl: `https://harbourview.sharepoint.com/sites/${site.name.replace(/[^A-Za-z0-9]/g, '')}`,
      siteExternalId: siteId,
      ownerDepartment: site.department,
      visibility: remediated ? 'private' : site.visibility,
      memberCount: site.members,
      guestMemberCount: site.guests,
      itemCount: site.items.length * sr.int(40, 400),
      lastModifiedAt: iso(modifiedMs),
      sensitivityLabelId: site.labelled || remediated ? 'lbl-confidential' : null,
      hasUniquePermissions: false,
      likelySensitive: siteReasons.length > 0,
      sensitivityReasons: siteReasons,
    });
    b.locations.push({
      externalId: libId,
      parentExternalId: siteId,
      kind: 'library',
      name: 'Documents',
      webUrl: `https://harbourview.sharepoint.com/sites/${site.name.replace(/[^A-Za-z0-9]/g, '')}/Shared Documents`,
      siteExternalId: siteId,
      ownerDepartment: site.department,
      visibility: 'unknown',
      memberCount: null,
      guestMemberCount: null,
      itemCount: null,
      lastModifiedAt: iso(modifiedMs),
      sensitivityLabelId: null,
      hasUniquePermissions: false,
      likelySensitive: false,
      sensitivityReasons: [],
    });
    if (site.guests > 0) {
      b.grants.push({
        externalId: `${siteId}:guest-members`,
        locationExternalId: siteId,
        scope: 'external-guest',
        roles: ['member'],
        grantedToExternalIds: [],
        externalPrincipalCount: site.guests,
        createdAt: null,
        expiresAt: null,
        inherited: false,
      });
    }

    site.items.forEach((itemName, iIdx) => {
      const itemId = `${siteId}-item-${iIdx + 1}`;
      const ir = createRandom(seed * 104_729 + sIdx * 1_000 + iIdx);
      const reasons = sensitiveNameReasons(itemName);
      const isFile = /\.[a-z0-9]{2,4}$/i.test(itemName);
      const grants: SharingGrant[] = [];
      const rAnyone = ir.next();
      const rOrg = ir.next();
      const rGuest = ir.next();
      const rLabel = ir.next();
      const base = {
        locationExternalId: itemId,
        grantedToExternalIds: [] as string[],
        inherited: false,
      };
      if (rAnyone < 0.22 * (1 - progress)) {
        grants.push({
          ...base,
          externalId: `${itemId}:anyone`,
          scope: 'anyone',
          roles: [ir.chance(0.3) ? 'write' : 'read'],
          externalPrincipalCount: 0,
          createdAt: iso(ir.int(30, 900) * DAY),
          expiresAt: ir.chance(0.2) ? iso(-ir.int(5, 60) * DAY) : null,
        });
      }
      if (rOrg < 0.35 * (1 - progress * 0.7)) {
        grants.push({
          ...base,
          externalId: `${itemId}:org`,
          scope: 'organization',
          roles: ['read'],
          externalPrincipalCount: 0,
          createdAt: iso(ir.int(30, 900) * DAY),
          expiresAt: null,
        });
      }
      if (rGuest < 0.14 * (1 - progress * 0.5)) {
        grants.push({
          ...base,
          externalId: `${itemId}:guest`,
          scope: 'external-guest',
          roles: ['read'],
          grantedToExternalIds: [`guest-${ir.int(1, 46)}`],
          externalPrincipalCount: 1,
          createdAt: iso(ir.int(30, 900) * DAY),
          expiresAt: null,
        });
      }
      const labelled = site.labelled ? rLabel < 0.7 : rLabel < 0.08 + progress * 0.5;
      b.locations.push({
        externalId: itemId,
        parentExternalId: libId,
        kind: isFile ? 'file' : 'folder',
        name: itemName,
        webUrl: null,
        siteExternalId: siteId,
        ownerDepartment: site.department,
        visibility: 'unknown',
        memberCount: null,
        guestMemberCount: null,
        itemCount: isFile ? null : ir.int(5, 300),
        lastModifiedAt: iso(modifiedMs + ir.int(0, 200) * DAY),
        sensitivityLabelId: labelled
          ? reasons.length
            ? 'lbl-highly-confidential'
            : 'lbl-general'
          : null,
        hasUniquePermissions: grants.length > 0,
        likelySensitive: reasons.length > 0,
        sensitivityReasons: reasons,
      });
      b.grants.push(...grants);
    });
  });

  return b;
}
