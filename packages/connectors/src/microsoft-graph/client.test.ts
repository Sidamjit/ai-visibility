import { describe, expect, it, vi } from 'vitest';
import { mockFetch, tokenRoute } from '../__fixtures__/mock-fetch';
import { GraphClient, GraphError, retryDelayMs } from './client';

const make = (fetchImpl: typeof fetch, sleep = vi.fn(async () => {})) => ({
  client: new GraphClient({
    entraTenantId: 't',
    clientId: 'c',
    clientSecret: 's',
    fetchImpl,
    sleep,
  }),
  sleep,
});

describe('GraphClient', () => {
  it('follows @odata.nextLink across pages', async () => {
    const { impl } = mockFetch([
      tokenRoute,
      ['skiptoken=2', { body: { value: [{ id: 3 }] } }],
      [
        '/users',
        {
          body: {
            value: [{ id: 1 }, { id: 2 }],
            '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?skiptoken=2',
          },
        },
      ],
    ]);
    const { client } = make(impl);
    expect(await client.list('/users')).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('honours Retry-After on 429 then succeeds', async () => {
    const { impl } = mockFetch([
      tokenRoute,
      [
        '/sites',
        [
          { status: 429, headers: { 'retry-after': '2' } },
          { status: 503 },
          { body: { value: [{ id: 's' }] } },
        ],
      ],
    ]);
    const { client, sleep } = make(impl);
    expect(await client.list('/sites')).toEqual([{ id: 's' }]);
    expect(sleep).toHaveBeenNthCalledWith(1, 2000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2000); // exponential: attempt 1 -> 2s
    expect(client.throttleCount).toBe(1);
  });

  it('refreshes the token once on 401', async () => {
    const { impl, calls } = mockFetch([
      tokenRoute,
      ['/me', [{ status: 401 }, { body: { ok: true } }]],
    ]);
    const { client } = make(impl);
    expect(await client.get('/me')).toEqual({ ok: true });
    expect(calls.filter((c) => c.url.includes('/token'))).toHaveLength(2);
  });

  it('throws GraphError with status and code on failure', async () => {
    const { impl } = mockFetch([
      tokenRoute,
      [
        '/x',
        { status: 403, body: { error: { code: 'Authorization_RequestDenied', message: 'nope' } } },
      ],
    ]);
    const { client } = make(impl);
    await expect(client.get('/x')).rejects.toMatchObject({
      status: 403,
      code: 'Authorization_RequestDenied',
    });
    await expect(client.get('/x')).rejects.toBeInstanceOf(GraphError);
  });

  it('gives up after maxRetries', async () => {
    const { impl } = mockFetch([tokenRoute, ['/busy', { status: 429 }]]);
    const client = new GraphClient({
      entraTenantId: 't',
      clientId: 'c',
      clientSecret: 's',
      fetchImpl: impl,
      sleep: async () => {},
      maxRetries: 2,
    });
    await expect(client.get('/busy')).rejects.toMatchObject({ status: 429 });
  });

  it('computes retry delays', () => {
    expect(retryDelayMs('5', 0)).toBe(5000);
    expect(retryDelayMs(null, 0)).toBe(1000);
    expect(retryDelayMs(null, 3)).toBe(8000);
    expect(retryDelayMs(null, 20)).toBe(60000);
  });
});
