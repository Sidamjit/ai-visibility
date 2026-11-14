/**
 * Redaction. Used for the OPTIONAL snippets (Settings → Content scanning →
 * snippet mode "redacted"; default "off") and for anything an LLM returns.
 *
 * A redacted snippet shows a little surrounding context so an analyst can tell
 * a payroll table from a test fixture, but:
 *   - the matched value is replaced by a type token, e.g. «NZ-IRD-NUMBER»,
 *   - every OTHER detected value in the window is replaced the same way,
 *   - any remaining run of 4+ digits is masked, and email addresses are masked,
 *   - whitespace is collapsed and length is capped.
 */
import type { RawMatch } from './classifiers/types';

export interface Span {
  index: number;
  length: number;
  classifierId: string;
}

const token = (id: string) => `«${id.toUpperCase()}»`;

/** Mask digit runs and emails in free text (defence in depth for context windows). */
export function maskResidual(text: string): string {
  return text
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '«EMAIL»')
    .replace(/\d(?:[\d ,.\-/]*\d){3,}/g, (m) => m.replace(/\d/g, '#'));
}

/**
 * Build a redacted snippet around `target`. `spans` are all detections in the
 * text (any classifier) so neighbouring values are removed too.
 */
export function redactSnippet(
  text: string,
  target: Span,
  spans: readonly Span[],
  contextChars: number,
  maxLength = 160,
): string {
  const start = Math.max(0, target.index - contextChars);
  const end = Math.min(text.length, target.index + target.length + contextChars);
  const inWindow = [target, ...spans]
    .filter((s) => s.index < end && s.index + s.length > start)
    .sort((a, b) => a.index - b.index);
  let out = '';
  let cursor = start;
  for (const s of inWindow) {
    const sStart = Math.max(s.index, start);
    if (sStart < cursor) continue; // overlapping span already replaced
    out += maskResidual(text.slice(cursor, sStart));
    out += token(s.classifierId);
    cursor = Math.min(end, s.index + s.length);
  }
  out += maskResidual(text.slice(cursor, end));
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > maxLength) out = `${out.slice(0, maxLength - 1)}…`;
  return `${start > 0 ? '…' : ''}${out}${end < text.length ? '…' : ''}`;
}

/** Redact free text (e.g. an LLM rationale) using the given detections. */
export function redactText(text: string, spans: readonly Span[]): string {
  let out = '';
  let cursor = 0;
  for (const s of [...spans].sort((a, b) => a.index - b.index)) {
    if (s.index < cursor) continue;
    out += text.slice(cursor, s.index) + token(s.classifierId);
    cursor = s.index + s.length;
  }
  return maskResidual(out + text.slice(cursor));
}

/** Convert raw matches of one classifier into spans. */
export const toSpans = (classifierId: string, matches: readonly RawMatch[]): Span[] =>
  matches.map((m) => ({ index: m.index, length: m.length, classifierId }));
