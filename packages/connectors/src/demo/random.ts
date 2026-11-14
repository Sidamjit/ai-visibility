/** Deterministic PRNG (mulberry32) so demo data is identical on every run and in tests. */
export function createRandom(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Integer in [min, max]. */
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    chance: (p: number) => next() < p,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)] as T,
  };
}
export type Random = ReturnType<typeof createRandom>;
