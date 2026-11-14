/**
 * The content scanner: bytes in, content-free `ContentScan` out.
 *
 * Lifecycle of file content (the only place it exists):
 *   1. connector downloads bytes into memory (never to disk),
 *   2. `scan()` hashes them, extracts text, runs classifiers (+ optional LLM),
 *   3. the byte buffer is zero-filled and all references are dropped,
 *   4. only the returned ContentScan (counts, hash, redacted snippets) is kept.
 */
import { createHash } from 'node:crypto';
import {
  ScanSettingsSchema,
  type ContentScan,
  type ContentScannerPort,
  type ScanSettings,
  type ScanTarget,
} from '@aiv/core';
import type { Policy } from '@aiv/policy';
import { buildClassifiers } from './classifiers/registry';
import type { Classifier } from './classifiers/types';
import { ExtractionError, extensionOf, extractText } from './extract';
import { llmAssess } from './llm/assess';
import type { LlmClient } from './llm/types';
import { classifyText } from './scan-text';

export interface CreateScannerOptions {
  settings?: Partial<ScanSettings>;
  /** Tenant policy: supplies classifier config (disabled + custom) and LLM levels. */
  policy?: Policy | null;
  /** Client-hosted LLM; used only when `settings.llmEnabled` is true. */
  llm?: LlmClient | null;
  now?: () => Date;
}

export interface ContentScanner extends ContentScannerPort {
  readonly classifiers: readonly Classifier[];
}

export function createContentScanner(opts: CreateScannerOptions = {}): ContentScanner {
  const settings = ScanSettingsSchema.parse(opts.settings ?? {});
  const classifiers = buildClassifiers(opts.policy?.classifiers);
  const allowed = new Set(
    settings.allowedExtensions.map((e) => e.toLowerCase().replace(/^\./, '')),
  );
  const now = opts.now ?? (() => new Date());
  const maxBytes = settings.maxFileSizeMb * 1024 * 1024;
  const llm = settings.llmEnabled && opts.llm && opts.policy ? opts.llm : null;

  const base = (t: ScanTarget) => ({
    locationExternalId: t.locationExternalId,
    siteExternalId: t.siteExternalId,
    extension: extensionOf(t.name),
    sizeBytes: t.sizeBytes,
    scannedAt: now().toISOString(),
  });

  const skipped = (t: ScanTarget, reason: string): ContentScan => ({
    ...base(t),
    contentSha256: null,
    status: 'skipped',
    statusReason: reason,
    textChars: 0,
    hits: [],
    llm: null,
  });

  return {
    settings,
    classifiers,
    skipReason(t) {
      if (!settings.enabled) return 'content scanning disabled';
      const ext = extensionOf(t.name);
      if (!allowed.has(ext)) return `file type .${ext || '(none)'} not in allow list`;
      if (t.sizeBytes > maxBytes) return `larger than ${settings.maxFileSizeMb} MB`;
      return null;
    },
    skipped,
    async scan(t, bytes) {
      const contentSha256 = createHash('sha256').update(bytes).digest('hex');
      try {
        if (bytes.byteLength > maxBytes)
          return { ...skipped(t, `larger than ${settings.maxFileSizeMb} MB`), contentSha256 };
        const { text, notes } = await extractText(bytes, extensionOf(t.name), {
          maxChars: settings.maxTextChars,
          maxUncompressedBytes: maxBytes * 8,
        });
        const { hits, spans } = classifyText(text, classifiers, settings);
        let assessment = null;
        if (llm && opts.policy && text.trim().length > 0) {
          try {
            assessment = await llmAssess(llm, text, opts.policy, spans);
          } catch {
            assessment = null; // LLM is advisory; deterministic hits still stand.
          }
        }
        return {
          ...base(t),
          contentSha256,
          status: 'scanned',
          statusReason: notes.length ? notes.join('; ') : null,
          textChars: text.length,
          hits,
          llm: assessment,
        };
      } catch (err) {
        const reason =
          err instanceof ExtractionError
            ? `${err.reason}: ${err.message}`
            : `error: ${(err as Error).message}`;
        return {
          ...base(t),
          contentSha256,
          status:
            err instanceof ExtractionError && err.reason === 'unsupported' ? 'skipped' : 'failed',
          statusReason: reason.slice(0, 300),
          textChars: 0,
          hits: [],
          llm: null,
        };
      } finally {
        bytes.fill(0); // best-effort: do not leave file content in the heap
      }
    },
  };
}
