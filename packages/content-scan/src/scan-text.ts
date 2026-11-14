/**
 * Run classifiers over extracted text and aggregate into content-free
 * `ClassifierHit`s. Raw matches never leave this function.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { ClassifierHit, Confidence, ScanSettings } from '@aiv/core';
import type { Classifier, RawMatch } from './classifiers/types';
import { redactSnippet, redactText, toSpans, type Span } from './redact';

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** Per-process random key: distinct-value counting without keeping values around. */
const PROCESS_KEY = randomBytes(32);

export interface ClassifyTextResult {
  hits: ClassifierHit[];
  /** All spans (for redacting LLM output). In-memory only. */
  spans: Span[];
}

export function classifyText(
  text: string,
  classifiers: readonly Classifier[],
  settings: Pick<ScanSettings, 'snippetMode' | 'snippetContextChars' | 'maxSnippetsPerClassifier'>,
): ClassifyTextResult {
  const results: Array<{ c: Classifier; matches: RawMatch[] }> = [];
  for (const c of classifiers) {
    const matches = c.detect(text);
    if (matches.length) results.push({ c, matches });
  }
  const spans = results.flatMap(({ c, matches }) => toSpans(c.id, matches));

  const hits: ClassifierHit[] = results.map(({ c, matches }) => {
    const distinct = new Set(
      matches.map((m) => createHmac('sha256', PROCESS_KEY).update(m.value).digest('base64')),
    );
    const confidence = matches.reduce<Confidence>(
      (best, m) => (RANK[m.confidence] > RANK[best] ? m.confidence : best),
      'low',
    );
    const snippets =
      settings.snippetMode === 'redacted'
        ? matches
            .slice(0, settings.maxSnippetsPerClassifier)
            .map((m) =>
              redactSnippet(
                text,
                { index: m.index, length: m.length, classifierId: c.id },
                spans,
                settings.snippetContextChars,
              ),
            )
        : [];
    return {
      classifierId: c.id,
      category: c.category,
      count: matches.length,
      distinctValues: distinct.size,
      confidence,
      snippets,
    };
  });
  return { hits, spans };
}

export { redactText };
