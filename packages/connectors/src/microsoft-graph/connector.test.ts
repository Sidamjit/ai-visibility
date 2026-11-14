import { describe, expect, it } from 'vitest';
import {
  NormalizedBatchSchema,
  ScanSettingsSchema,
  type ContentScan,
  type ContentScannerPort,
  type ScanTarget,
} from '@aiv/core';
import { silentLogger } from '../types';
import * as fx from '../__fixtures__/graph';
import { mockFetch, tokenRoute, type MockResponse } from '../__fixtures__/mock-fetch';
import { microsoftGraphConnector, type GraphConfig } from './connector';

function routes(
  delta: Array<[string | RegExp, MockResponse]>,
): Array<[string | RegExp, MockResponse | MockResponse[]]> {
  return [
    tokenRoute,
    [
      '/security/informationProtection/sensitivityLabels',
      { body: { value: [{ id: 'lbl-c', name: 'Confidential', sensitivity: 2 }] } },
    ],
    [/\/users\?/, { body: { value: fx.users } }],
    ['/subscribedSkus', { body: { value: fx.skus } }],
    ['getMicrosoft365CopilotUsageUserDetail', { body: { value: fx.copilotUsage } }],
    ['/groups/grp1/sites/root', { body: { id: 'site1' } }],
    [/\/groups\/grp1\/members\/microsoft\.graph\.user\/\$count/, { body: 2 }],
    [/\/groups\/grp1\/members\/\$count/, { body: 300 }],
    [/\/groups\?/, { body: { value: fx.groups } }],
    ['/sites/getAllSites', { body: { value: fx.sites } }],
    ['/sites/site1/drives', { body: { value: fx.drives } }],
    ...delta,
    ['/items/it1/permissions', { body: { value: fx.permissions.it1 } }],
    ['/items/it3/permissions', { body: { value: fx.permissions.it3 } }],
  ];
}

const ctx = (fetchImpl: typeof fetch) => ({
  tenantId: 't1',
  config: { includeOneDrive: false } as GraphConfig,
  secrets: { GRAPH_TENANT_ID: fx.TENANT, GRAPH_CLIENT_ID: 'cid', GRAPH_CLIENT_SECRET: 'secret' },
  logger: silentLogger,
  fetch: fetchImpl,
  now: () => new Date('2026-11-14T00:00:00Z'),
});

describe('microsoftGraphConnector.sync', () => {
  it('performs a full sync producing valid normalized data and a delta cursor', async () => {
    const { impl, calls } = mockFetch(
      routes([
        ['skiptoken=page2', { body: fx.deltaPage2 }],
        ['/drives/drv1/root/delta', { body: fx.deltaPage1 }],
      ]),
    );
    const res = await microsoftGraphConnector.sync(ctx(impl), null);
    expect(() => NormalizedBatchSchema.parse(res.batch)).not.toThrow();
    expect(res.fullSync).toBe(true);
    expect(res.warnings).toEqual([]);
    expect(res.nextCursor.driveDeltaLinks).toEqual({ drv1: fx.deltaPage2['@odata.deltaLink'] });

    const b = res.batch;
    expect(b.identities).toHaveLength(3);
    expect(b.licences).toHaveLength(2);
    expect(b.usage).toHaveLength(2); // unknown UPN dropped
    expect(b.labels[0]).toMatchObject({ name: 'Confidential', isSensitive: true });
    // OneDrive excluded by default; site is a public team with 300 members.
    expect(b.locations.find((l) => l.externalId === 'od1')).toBeUndefined();
    expect(b.locations.find((l) => l.externalId === 'site1')).toMatchObject({
      visibility: 'public',
      memberCount: 300,
    });
    // Only shared or sensitive items kept: it1 (shared+payroll) and it3 (shared, board pack path); not it2.
    expect(b.locations.map((l) => l.externalId).sort()).toEqual(['drv1', 'it1', 'it3', 'site1']);
    expect(b.locations.find((l) => l.externalId === 'it1')?.hasUniquePermissions).toBe(true);
    expect(b.grants.map((g) => g.scope).sort()).toEqual([
      'anyone',
      'direct',
      'external-guest',
      'external-guest',
      'organization',
    ]);
    // Never downloads file content.
    expect(calls.some((c) => c.url.includes('/content'))).toBe(false);
    // Sends hierarchical sharing preference for delta.
    const deltaCall = calls.find((c) => c.url.includes('/root/delta'));
    expect(JSON.stringify(deltaCall?.init?.headers)).toContain('hierarchicalsharing');
  });

  it('runs incrementally from the stored deltaLink and reports deletions', async () => {
    const { impl, calls } = mockFetch(routes([['token=DELTA1', { body: fx.deltaIncremental }]]));
    const res = await microsoftGraphConnector.sync(ctx(impl), {
      driveDeltaLinks: { drv1: fx.deltaPage2['@odata.deltaLink'] },
      lastFullSyncAt: '2026-11-01T00:00:00Z',
    });
    expect(res.fullSync).toBe(false);
    expect(res.deletions.locations).toEqual(['it3']);
    expect(res.nextCursor.driveDeltaLinks).toEqual({
      drv1: fx.deltaIncremental['@odata.deltaLink'],
    });
    expect(calls.some((c) => c.url.includes('token=DELTA1'))).toBe(true);
  });

  it('degrades gracefully when optional permissions are missing', async () => {
    const denied = { status: 403, body: { error: { code: 'Forbidden', message: 'Missing role' } } };
    const { impl } = mockFetch([
      ['/security/informationProtection', denied],
      ['signInActivity', denied],
      ...routes([['/drives/drv1/root/delta', { body: { value: [], '@odata.deltaLink': 'x' } }]]),
    ]);
    const res = await microsoftGraphConnector.sync(ctx(impl), null);
    expect(res.batch.identities).toHaveLength(3);
    expect(res.warnings.join(' ')).toMatch(/Sensitivity labels/);
    expect(res.warnings.join(' ')).toMatch(/Sign-in activity/);
  });

  it('falls back to the legacy Copilot report path when the new one is unavailable', async () => {
    const { impl, calls } = mockFetch([
      ['/copilot/reports/', { status: 404, body: { error: { code: 'NotFound', message: 'no' } } }],
      ...routes([['/drives/drv1/root/delta', { body: { value: [], '@odata.deltaLink': 'x' } }]]),
    ]);
    const res = await microsoftGraphConnector.sync(ctx(impl), null);
    expect(res.batch.usage).toHaveLength(2);
    expect(
      calls.some((c) =>
        c.url.includes("/beta/reports/getMicrosoft365CopilotUsageUserDetail(period='D30')"),
      ),
    ).toBe(true);
  });

  it('fails clearly when secrets are missing', async () => {
    const { impl } = mockFetch([]);
    await expect(microsoftGraphConnector.sync({ ...ctx(impl), secrets: {} }, null)).rejects.toThrow(
      /GRAPH_CLIENT_SECRET/,
    );
  });

  describe('content scanning', () => {
    /** Fake scanner: flags files whose bytes contain "IRD". Records what it saw. */
    function fakeScanner(maxFilesPerRun = 100) {
      const seen: string[] = [];
      const settings = ScanSettingsSchema.parse({
        maxFilesPerRun,
        allowedExtensions: ['xlsx', 'docx'],
      });
      const base = (t: ScanTarget): ContentScan => ({
        locationExternalId: t.locationExternalId,
        siteExternalId: t.siteExternalId,
        extension: t.name.split('.').pop() ?? '',
        sizeBytes: t.sizeBytes,
        sourceVersion: t.sourceVersion,
        contentSha256: null,
        scannedAt: '2026-11-14T00:00:00.000Z',
        status: 'skipped',
        statusReason: null,
        textChars: 0,
        hits: [],
        llm: null,
      });
      const scanner: ContentScannerPort = {
        settings,
        skipReason: (t) => (/\.(xlsx|docx)$/.test(t.name) ? null : 'file type not in allow list'),
        skipped: (t, reason) => ({ ...base(t), statusReason: reason }),
        async scan(t, bytes) {
          const text = new TextDecoder().decode(bytes);
          seen.push(t.locationExternalId);
          bytes.fill(0);
          return {
            ...base(t),
            status: 'scanned',
            contentSha256: 'abc',
            textChars: text.length,
            hits: text.includes('IRD')
              ? [
                  {
                    classifierId: 'nz-ird-number',
                    category: 'government-id',
                    count: 2,
                    distinctValues: 2,
                    confidence: 'high',
                    snippets: [],
                  },
                ]
              : [],
          };
        },
      };
      return { scanner, seen };
    }
    const withContent: Array<[string | RegExp, MockResponse]> = [
      ['/items/it1/content', { body: 'payroll IRD 49091850' }],
      ['/items/it2/content', { body: 'lunch menu IRD 35901981 (staff list)' }],
      ['/items/it3/content', { body: 'quarterly numbers' }],
      [
        /\/items\/it[0-9]\/extractSensitivityLabels/,
        { body: { value: { labels: [{ sensitivityLabelId: 'lbl-c' }] } } },
      ],
      ['skiptoken=page2', { body: fx.deltaPage2 }],
      ['/drives/drv1/root/delta', { body: fx.deltaPage1 }],
    ];

    it('downloads files in memory, keeps classified files and reads their labels', async () => {
      const { impl, calls } = mockFetch(routes(withContent));
      const { scanner, seen } = fakeScanner();
      const res = await microsoftGraphConnector.sync(
        { ...ctx(impl), contentScanner: scanner },
        null,
      );
      expect(seen.sort()).toEqual(['it1', 'it2', 'it3']);
      expect(res.batch.contentScans).toHaveLength(3);
      // it2 is neither shared nor sensitively named, but its CONTENT is classified -> kept.
      const it2 = res.batch.locations.find((l) => l.externalId === 'it2');
      expect(it2).toMatchObject({ sensitivityLabelId: 'lbl-c' });
      expect(calls.filter((c) => c.url.includes('extractSensitivityLabels'))).toHaveLength(2);
      expect(calls.find((c) => c.url.includes('extractSensitivityLabels'))?.init?.method).toBe(
        'POST',
      );
      expect(res.stats).toMatchObject({ filesDownloaded: 3, filesWithHits: 2 });
      expect(res.contentScanScope).toMatchObject({ fullEnumeration: true });
      expect(res.contentScanScope?.seenFileIds.sort()).toEqual(['it1', 'it2', 'it3']);
    });

    it('skips unchanged files using known content versions', async () => {
      const { scanner, seen } = fakeScanner();
      const known = new Map([
        ['it1', { version: 'c-it1', hadHits: true }],
        ['it2', { version: 'old', hadHits: false }],
      ]);
      const delta1 = {
        ...fx.deltaPage1,
        value: fx.deltaPage1.value.map((v) => (v.id === 'it1' ? { ...v, cTag: 'c-it1' } : v)),
      };
      const { impl: impl2 } = mockFetch(
        routes([
          ['skiptoken=page2', { body: fx.deltaPage2 }],
          ['/drives/drv1/root/delta', { body: delta1 }],
          ...withContent,
        ]),
      );
      const res = await microsoftGraphConnector.sync(
        { ...ctx(impl2), contentScanner: scanner, knownContentVersions: known },
        null,
      );
      expect(seen).not.toContain('it1');
      expect(res.stats).toMatchObject({ filesUnchanged: 1 });
      // Still kept (shared + previously classified) and its label refreshed.
      expect(res.batch.locations.find((l) => l.externalId === 'it1')?.sensitivityLabelId).toBe(
        'lbl-c',
      );
    });

    it('does not advance the delta cursor when the per-run cap defers files', async () => {
      const { impl } = mockFetch(routes(withContent));
      const { scanner, seen } = fakeScanner(1);
      const res = await microsoftGraphConnector.sync(
        { ...ctx(impl), contentScanner: scanner },
        null,
      );
      expect(seen).toHaveLength(1);
      expect(res.nextCursor.driveDeltaLinks).toEqual({});
      expect(res.warnings.join(' ')).toMatch(/per-run cap/);
    });

    it('never downloads content without a scanner', async () => {
      const { impl, calls } = mockFetch(routes(withContent));
      await microsoftGraphConnector.sync(ctx(impl), null);
      expect(calls.some((c) => c.url.includes('/content'))).toBe(false);
    });
  });
});
