/**
 * The connector plugin contract.
 *
 * A connector is a self-contained module that knows how to talk to ONE source
 * (Microsoft Graph, ChatGPT Enterprise, a webhook, ...) and translate it into the
 * normalized model from `@aiv/core`. Connectors:
 *   - are READ-ONLY against the source,
 *   - persist METADATA only. Connectors that can read documents (Microsoft
 *     Graph) pass bytes to `ctx.contentScanner`, which returns content-free
 *     classifier results; bytes are never stored,
 *   - are stateless: anything they need to remember between runs goes in the
 *     opaque `cursor` they return, which the worker persists for them,
 *   - receive secrets via `ConnectorContext.secrets` (populated from env vars),
 *     never from the database.
 *
 * See docs/ADDING_A_CONNECTOR.md for a walkthrough.
 */
import type { z } from 'zod';
import type { ContentScannerPort, NormalizedBatch } from '@aiv/core';

/** One API permission/scope the source admin must grant, and why we need it. */
export interface PermissionRequirement {
  /** Exact permission name as shown in the source's admin console. */
  name: string;
  /** e.g. 'Application' (app-only) or 'Delegated'. */
  type: 'Application' | 'Delegated' | 'API key' | 'Admin role';
  /** Plain-English justification shown to the client's IT admin. */
  reason: string;
  /** Data we read with it. */
  dataAccessed: string;
  /** False when the connector degrades gracefully without it. */
  required: boolean;
}

/** Minimal logger interface so connectors stay framework-agnostic. */
export interface ConnectorLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Runtime context handed to every connector call. */
export interface ConnectorContext<TConfig = unknown> {
  /** Our tenant (the customer organisation) — NOT the Entra tenant ID. */
  tenantId: string;
  /** Validated, non-secret configuration (stored in DB, editable in UI). */
  config: TConfig;
  /** Secrets resolved from environment variables at runtime. */
  secrets: Record<string, string | undefined>;
  logger: ConnectorLogger;
  /** Injected for tests. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Injected clock for deterministic tests. */
  now?: () => Date;
  /**
   * Content scanner (from @aiv/content-scan), provided by the pipeline when the
   * tenant has content scanning enabled. Absent = metadata-only sync.
   */
  contentScanner?: ContentScannerPort;
  /**
   * locationExternalId -> source version (e.g. Graph cTag) of files already
   * scanned, so re-enumerations skip unchanged files.
   */
  knownContentVersions?: ReadonlyMap<string, { version: string; hadHits: boolean }>;
}

/** Opaque, JSON-serializable state a connector uses for incremental sync. */
export type ConnectorCursor = Record<string, unknown>;

export interface AuthCheckResult {
  ok: boolean;
  /** Human-readable detail, e.g. which permission is missing. */
  message: string;
  /** Permissions confirmed missing, if the connector can tell. */
  missingPermissions?: string[];
}

export interface SyncResult {
  /** Normalized data produced by this run (full or incremental). */
  batch: NormalizedBatch;
  /** Cursor to pass to the next `sync()` call. */
  nextCursor: ConnectorCursor;
  /** True when this run was a full (non-incremental) sync. */
  fullSync: boolean;
  /** External IDs the source reports as deleted since the last cursor. */
  deletions: { locations: string[]; grants: string[] };
  /**
   * Present when content scanning ran. On a full enumeration, `seenFileIds`
   * lists every file id seen, so stored scans of files that no longer exist
   * can be removed (content scans survive full syncs so unchanged files are not
   * re-downloaded).
   */
  contentScanScope?: { fullEnumeration: boolean; seenFileIds: string[]; deletedFileIds: string[] };
  /** Counters for the sync log (items scanned, API calls, ...). */
  stats: Record<string, number>;
  /** Non-fatal problems (e.g. optional permission missing). Shown in the UI. */
  warnings: string[];
}

export type ConnectorMaturity = 'available' | 'preview' | 'planned';

/**
 * Every connector implements this interface.
 * @typeParam TConfig - shape of the connector's non-secret configuration.
 */
export interface Connector<TConfig = unknown> {
  /** Stable machine ID, kebab-case, e.g. 'microsoft-graph'. Never change once shipped. */
  readonly id: string;
  readonly displayName: string;
  readonly vendor: string;
  readonly description: string;
  readonly maturity: ConnectorMaturity;
  /** Everything the source admin must grant. Rendered in the UI and PILOT_SETUP.md. */
  readonly requiredPermissions: readonly PermissionRequirement[];
  /** Names of environment variables holding this connector's secrets. */
  readonly secretEnvVars: readonly string[];
  /** zod schema for `ConnectorContext.config`. */
  readonly configSchema: z.ZodType<TConfig>;
  /** Verify credentials & permissions without pulling data. */
  authenticate(ctx: ConnectorContext<TConfig>): Promise<AuthCheckResult>;
  /**
   * Pull data. `sinceCursor` is null for the first (full) sync; otherwise the
   * `nextCursor` from the previous successful run.
   */
  sync(ctx: ConnectorContext<TConfig>, sinceCursor: ConnectorCursor | null): Promise<SyncResult>;
}

/** Error thrown by planned/stub connectors so callers can show "coming soon". */
export class ConnectorNotImplementedError extends Error {
  constructor(connectorId: string) {
    super(`Connector '${connectorId}' is planned but not implemented yet.`);
    this.name = 'ConnectorNotImplementedError';
  }
}

/** Console-backed logger used by the worker and tests. */
export const consoleLogger: ConnectorLogger = {
  info: (m, meta) => console.info(`[connector] ${m}`, meta ?? ''),
  warn: (m, meta) => console.warn(`[connector] ${m}`, meta ?? ''),
  error: (m, meta) => console.error(`[connector] ${m}`, meta ?? ''),
};

/** Logger that discards everything (tests). */
export const silentLogger: ConnectorLogger = { info: () => {}, warn: () => {}, error: () => {} };
