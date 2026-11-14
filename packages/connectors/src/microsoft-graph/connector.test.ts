import { describe, expect, it } from 'vitest';
import { NormalizedBatchSchema } from '@aiv/core';
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
});
