/**
 * Minimal, dependency-free Microsoft Graph client for app-only (client
 * credentials) access.
 *
 * Why not the official SDK? It pulls in a large dependency tree and hides the
 * exact HTTP calls; for a security product we want every call auditable in one
 * small file. This client handles:
 *  - OAuth2 client-credentials token acquisition + caching,
 *  - paging via `@odata.nextLink`,
 *  - delta queries via `@odata.deltaLink` (incremental sync),
 *  - throttling: HTTP 429/503/504 honour `Retry-After`, else exponential backoff,
 *  - one transparent token refresh on 401.
 *
 * Docs: https://learn.microsoft.com/graph/throttling ,
 *       https://learn.microsoft.com/graph/paging ,
 *       https://learn.microsoft.com/graph/delta-query-overview
 */

export interface GraphClientOptions {
  /** Entra (Azure AD) directory/tenant ID of the CLIENT organisation. */
  entraTenantId: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  /** Override for national clouds. Default: https://graph.microsoft.com */
  graphBaseUrl?: string;
  /** Override for national clouds. Default: https://login.microsoftonline.com */
  authorityBaseUrl?: string;
  /** Max retries for throttled/transient responses. */
  maxRetries?: number;
  /** Injected for tests so retries don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    readonly url: string,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

interface GraphPage<T> {
  value?: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

const RETRYABLE = new Set([429, 503, 504]);

export class GraphClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly graphBase: string;
  private readonly authorityBase: string;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Number of HTTP requests made (for sync stats). */
  requestCount = 0;
  /** Number of throttled responses encountered. */
  throttleCount = 0;

  constructor(private readonly opts: GraphClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.graphBase = (opts.graphBaseUrl ?? 'https://graph.microsoft.com').replace(/\/$/, '');
    this.authorityBase = (opts.authorityBaseUrl ?? 'https://login.microsoftonline.com').replace(
      /\/$/,
      '',
    );
    this.maxRetries = opts.maxRetries ?? 6;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Acquire (or reuse) an app-only access token for Graph. */
  async getToken(forceRefresh = false): Promise<string> {
    const now = Date.now();
    if (!forceRefresh && this.token && this.token.expiresAt - 60_000 > now) return this.token.value;

    const url = `${this.authorityBase}/${encodeURIComponent(this.opts.entraTenantId)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.opts.clientId,
      client_secret: this.opts.clientSecret,
      scope: `${this.graphBase}/.default`,
    });
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new GraphError(
        `Token request failed: ${json.error ?? res.status} ${json.error_description ?? ''}`.trim(),
        res.status,
        json.error,
        url,
      );
    }
    this.token = { value: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  /** Resolve a relative Graph path (e.g. '/users') or pass an absolute nextLink through. */
  resolve(pathOrUrl: string, version: 'v1.0' | 'beta' = 'v1.0'): string {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return `${this.graphBase}/${version}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  }

  /**
   * GET a Graph resource with retry/throttling handling.
   * Returns parsed JSON, or raw text when the response is not JSON (e.g. `$count`).
   */
  async get<T>(
    pathOrUrl: string,
    init: { version?: 'v1.0' | 'beta'; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const url = this.resolve(pathOrUrl, init.version);
    let refreshed = false;

    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken();
      this.requestCount++;
      const res = await this.fetchImpl(url, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...init.headers },
      });

      if (res.ok) {
        const type = res.headers.get('content-type') ?? '';
        return (type.includes('json') ? await res.json() : await res.text()) as T;
      }

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.getToken(true);
        continue;
      }

      if (RETRYABLE.has(res.status) && attempt < this.maxRetries) {
        if (res.status === 429) this.throttleCount++;
        await this.sleep(retryDelayMs(res.headers.get('retry-after'), attempt));
        continue;
      }

      const err = (await res.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
      };
      throw new GraphError(
        `Graph GET ${url} failed (${res.status}): ${err.error?.message ?? res.statusText}`,
        res.status,
        err.error?.code,
        url,
      );
    }
  }

  /** Iterate all items across pages of a collection. */
  async *paginate<T>(
    path: string,
    init: { version?: 'v1.0' | 'beta'; headers?: Record<string, string>; maxItems?: number } = {},
  ): AsyncGenerator<T> {
    let next: string | undefined = path;
    let yielded = 0;
    while (next) {
      const page: GraphPage<T> = await this.get<GraphPage<T>>(next, init);
      for (const item of page.value ?? []) {
        yield item;
        if (init.maxItems && ++yielded >= init.maxItems) return;
      }
      next = page['@odata.nextLink'];
    }
  }

  /** Collect a whole collection into an array. */
  async list<T>(
    path: string,
    init: { version?: 'v1.0' | 'beta'; headers?: Record<string, string>; maxItems?: number } = {},
  ): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this.paginate<T>(path, init)) out.push(item);
    return out;
  }

  /**
   * Run a delta query to completion. Pass the previous `deltaLink` to receive
   * only changes; pass the initial delta path for a full enumeration.
   */
  async delta<T>(
    pathOrDeltaLink: string,
    init: { headers?: Record<string, string>; maxItems?: number } = {},
  ): Promise<{ items: T[]; deltaLink: string | null; truncated: boolean }> {
    const items: T[] = [];
    let next: string | undefined = pathOrDeltaLink;
    let deltaLink: string | null = null;
    while (next) {
      const page: GraphPage<T> = await this.get<GraphPage<T>>(next, { headers: init.headers });
      items.push(...(page.value ?? []));
      if (init.maxItems && items.length >= init.maxItems) {
        // Stop early; without a deltaLink the next run will do a full enumeration again.
        return { items: items.slice(0, init.maxItems), deltaLink: null, truncated: true };
      }
      deltaLink = page['@odata.deltaLink'] ?? deltaLink;
      next = page['@odata.nextLink'];
    }
    return { items, deltaLink, truncated: false };
  }
}

/**
 * Compute how long to wait before retrying. Graph sends `Retry-After` in
 * seconds; otherwise back off exponentially (1s, 2s, 4s ... capped at 60s).
 */
export function retryDelayMs(retryAfterHeader: string | null, attempt: number): number {
  const seconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 300) * 1000;
  return Math.min(1000 * 2 ** attempt, 60_000);
}
