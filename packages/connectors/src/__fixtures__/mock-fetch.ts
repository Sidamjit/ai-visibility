/**
 * Tiny fetch mock: route by URL substring, record calls. Each route may be a
 * list of responses consumed in order (last one repeats), to simulate 429s.
 */
export interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export function mockFetch(routes: Array<[string | RegExp, MockResponse | MockResponse[]]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const counters = new Map<number, number>();
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const idx = routes.findIndex(([m]) => (typeof m === 'string' ? url.includes(m) : m.test(url)));
    if (idx < 0)
      return new Response(JSON.stringify({ error: { code: 'NotMocked', message: url } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    const spec = routes[idx]![1];
    const list = Array.isArray(spec) ? spec : [spec];
    const n = counters.get(idx) ?? 0;
    counters.set(idx, n + 1);
    const r = list[Math.min(n, list.length - 1)]!;
    const isText = typeof r.body === 'string' || typeof r.body === 'number';
    return new Response(isText ? String(r.body) : JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: { 'content-type': isText ? 'text/plain' : 'application/json', ...r.headers },
    });
  }) as typeof fetch;
  return { impl, calls };
}

export const tokenRoute: [string, MockResponse] = [
  '/oauth2/v2.0/token',
  { body: { access_token: 'tok', expires_in: 3600 } },
];
