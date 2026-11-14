/**
 * Content-scan results and scan settings (normalized, content-free).
 *
 * The content scanner (`@aiv/content-scan`) reads a file's bytes in memory,
 * extracts text, runs classifiers and then DISCARDS the bytes and text. Only the
 * shapes below are ever persisted:
 *   - which classifiers matched and how many times (counts, distinct values),
 *   - a SHA-256 of the file bytes (change detection / duplicate detection),
 *   - optionally, short REDACTED snippets (off by default — see `snippetMode`).
 *
 * Matched values themselves (an IRD number, a card number, a password) are
 * NEVER stored. `distinctValues` is computed from salted hashes in memory.
 */
import { z } from 'zod';

const isoDate = z.iso.datetime({ offset: true });

/** Broad families of sensitive information; used for grouping and policy mapping. */
export const CLASSIFIER_CATEGORIES = [
  'government-id',
  'financial',
  'health',
  'personal',
  'contact',
  'credential',
  'custom',
] as const;
export type ClassifierCategory = (typeof CLASSIFIER_CATEGORIES)[number];

export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** Aggregated matches of ONE classifier in ONE file. */
export const ClassifierHitSchema = z.object({
  classifierId: z.string(),
  category: z.enum(CLASSIFIER_CATEGORIES),
  /** Total matches (after validation such as checksums). */
  count: z.number().int().nonnegative(),
  /** Distinct matched values (computed from salted hashes; values are never stored). */
  distinctValues: z.number().int().nonnegative(),
  /** Highest confidence among matches. */
  confidence: z.enum(CONFIDENCE_LEVELS),
  /** Redacted context snippets. Empty unless the tenant enabled `snippetMode: 'redacted'`. */
  snippets: z.array(z.string()).default([]),
});
export type ClassifierHit = z.infer<typeof ClassifierHitSchema>;

/** Optional result from a client-hosted LLM classifier (disabled by default). */
export const LlmAssessmentSchema = z.object({
  provider: z.string(),
  model: z.string(),
  /** Suggested classification level id from the tenant policy, if any. */
  levelId: z.string().nullable(),
  categories: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  /** Short rationale. Instructed NOT to quote content; still redacted before storage. */
  rationale: z.string().max(500),
});
export type LlmAssessment = z.infer<typeof LlmAssessmentSchema>;

export const SCAN_STATUSES = ['scanned', 'skipped', 'failed'] as const;

/** Result of scanning one file. One row per file (replaced when the file changes). */
export const ContentScanSchema = z.object({
  /** The file's ContentLocation externalId (drive item id). */
  locationExternalId: z.string(),
  siteExternalId: z.string().nullable(),
  /** Lower-case extension without dot, e.g. 'docx'. */
  extension: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** SHA-256 (hex) of the file bytes. Null when skipped before download. */
  contentSha256: z.string().nullable(),
  /** Source version (e.g. Graph cTag) — unchanged files are not re-downloaded. */
  sourceVersion: z.string().nullable().default(null),
  scannedAt: isoDate,
  status: z.enum(SCAN_STATUSES),
  /** Why the file was skipped/failed (too large, unsupported type, encrypted, ...). */
  statusReason: z.string().nullable(),
  /** Characters of text extracted (0 for images / encrypted files). */
  textChars: z.number().int().nonnegative(),
  hits: z.array(ClassifierHitSchema),
  llm: LlmAssessmentSchema.nullable().default(null),
});
export type ContentScan = z.infer<typeof ContentScanSchema>;

export const SNIPPET_MODES = ['off', 'redacted'] as const;

/** File types the built-in extractors understand. */
export const SUPPORTED_EXTENSIONS = [
  'docx',
  'xlsx',
  'pptx',
  'pdf',
  'txt',
  'csv',
  'md',
  'json',
  'xml',
  'html',
  'eml',
  'msg',
] as const;

/**
 * Per-tenant scan settings (Settings → Content scanning). Stored on the tenant,
 * passed to connectors at sync time. Defaults favour data minimisation.
 */
export const ScanSettingsSchema = z.object({
  /** Master switch. When false, no file content is downloaded. */
  enabled: z.boolean().default(true),
  /** Files larger than this are skipped (recorded as 'skipped'). */
  maxFileSizeMb: z.number().positive().max(200).default(25),
  /** Only these extensions are downloaded. */
  allowedExtensions: z.array(z.string()).default([...SUPPORTED_EXTENSIONS]),
  /** Parallel downloads per sync (also bounded by connector concurrency). */
  concurrency: z.number().int().min(1).max(16).default(4),
  /** Max files downloaded per sync run (spreads a large first scan over several runs). */
  maxFilesPerRun: z.number().int().positive().default(20_000),
  /** Text beyond this many characters is ignored (protects memory/CPU). */
  maxTextChars: z.number().int().positive().default(2_000_000),
  /** 'off' (default): no snippets stored. 'redacted': short masked context only. */
  snippetMode: z.enum(SNIPPET_MODES).default('off'),
  /** Characters of context either side of a match in redacted snippets. */
  snippetContextChars: z.number().int().min(0).max(80).default(20),
  /** Max snippets kept per classifier per file. */
  maxSnippetsPerClassifier: z.number().int().min(0).max(10).default(2),
  /** Send extracted text to the CLIENT-HOSTED LLM classifier (also needs LLM_PROVIDER env). */
  llmEnabled: z.boolean().default(false),
});
export type ScanSettings = z.infer<typeof ScanSettingsSchema>;

export const DEFAULT_SCAN_SETTINGS: ScanSettings = ScanSettingsSchema.parse({});

/** Metadata about a file the connector is about to (or decided not to) scan. */
export interface ScanTarget {
  locationExternalId: string;
  siteExternalId: string | null;
  name: string;
  sizeBytes: number;
  /** Source version (e.g. Graph cTag), stored so unchanged files are skipped later. */
  sourceVersion: string | null;
}

/**
 * The scanner as seen by connectors (implemented by `@aiv/content-scan`).
 * Connectors download bytes, hand them to `scan`, and drop their reference;
 * the scanner zero-fills the buffer when it is done.
 */
export interface ContentScannerPort {
  readonly settings: ScanSettings;
  /** Null when the file should be downloaded and scanned, else the skip reason. */
  skipReason(target: ScanTarget): string | null;
  /** Record a file that was not downloaded (too large, wrong type, run cap). */
  skipped(target: ScanTarget, reason: string): ContentScan;
  /** Extract, classify and discard. Never throws for bad files (returns status 'failed'). */
  scan(target: ScanTarget, bytes: Uint8Array): Promise<ContentScan>;
}
