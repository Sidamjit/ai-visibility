/** Small shared helpers for connectors. */

/**
 * Run `fn` over `items` with at most `limit` in flight. Keeps Graph calls
 * parallel enough to be fast but well under per-app throttling limits.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * A shared concurrency limiter: `limit(fn)` runs fn when fewer than `max`
 * limited calls are in flight. Used to cap content downloads ACROSS sites.
 */
export function createLimiter(max: number): <R>(fn: () => Promise<R>) => Promise<R> {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= max) return;
    const run = queue.shift();
    if (run) {
      active++;
      run();
    }
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
}
