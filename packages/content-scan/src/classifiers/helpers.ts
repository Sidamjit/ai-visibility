import type { Confidence } from '@aiv/core';
import type { RawMatch } from './types';

/** Iterate global-regex matches without the footguns of `lastIndex`. */
export function* matchAll(text: string, re: RegExp): Generator<RegExpExecArray> {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = g.exec(text)) !== null) {
    if (m[0].length === 0) {
      g.lastIndex++;
      continue;
    }
    yield m;
  }
}

/** True when `context` matches within `window` characters around the match. */
export function nearby(
  text: string,
  index: number,
  length: number,
  context: RegExp,
  window = 60,
): boolean {
  const start = Math.max(0, index - window);
  return context.test(text.slice(start, index + length + window));
}

export function match(m: RegExpExecArray, value: string, confidence: Confidence): RawMatch {
  return { value, index: m.index, length: m[0].length, confidence };
}

export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive keyword regex; whitespace in phrases matches any whitespace. */
export function keywordRegExp(keywords: readonly string[]): RegExp {
  const alts = keywords.map((k) => escapeRegExp(k.trim()).replace(/\s+/g, '\\s+'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

/**
 * For identifier formats shared by several document types (e.g. passport and
 * driver licence numbers), return which context keyword appears CLOSEST before
 * the match within `window` characters, or null.
 */
export function closestPrecedingContext(
  text: string,
  index: number,
  contexts: Record<string, RegExp>,
  window = 50,
): string | null {
  const before = text.slice(Math.max(0, index - window), index);
  let best: { key: string; at: number } | null = null;
  for (const [key, re] of Object.entries(contexts)) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of before.matchAll(g)) if (!best || m.index > best.at) best = { key, at: m.index };
  }
  return best?.key ?? null;
}
