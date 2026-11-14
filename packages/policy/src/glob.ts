/** Case-insensitive glob ("*" = any run of characters, "?" = one character). */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/** True when any pattern matches any of the candidate strings. */
export function matchesAny(
  patterns: readonly string[],
  candidates: ReadonlyArray<string | null>,
): boolean {
  const res = patterns.map(globToRegExp);
  return candidates.some((c) => c !== null && res.some((re) => re.test(c)));
}
