export type RateLimitResult = { ok: boolean; retryAfterMs: number };

export type RateLimiter = {
  /** Records an attempt for `key` (only while allowed) and says whether it may proceed. */
  check(key: string): RateLimitResult;
  /** Number of keys currently tracked (for tests / monitoring). */
  size(): number;
};

/**
 * In-memory sliding-window limiter. Per-process state: good enough for a single
 * instance; swap for a shared store if the app ever scales horizontally.
 */
export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
  maxKeys = 10_000,
}: {
  limit: number;
  windowMs: number;
  now?: () => number;
  /** Hard cap on tracked keys; oldest keys are evicted beyond it. */
  maxKeys?: number;
}): RateLimiter {
  const hits = new Map<string, number[]>();
  let lastSweep = now();

  // Full sweep at most once per window keeps memory bounded without O(n) work per call.
  function sweep(t: number): void {
    if (t - lastSweep < windowMs) return;
    lastSweep = t;
    for (const [key, list] of hits) {
      if (list[list.length - 1] <= t - windowMs) hits.delete(key);
    }
  }

  return {
    check(key) {
      const t = now();
      sweep(t);
      const fresh = (hits.get(key) ?? []).filter((h) => h > t - windowMs);
      if (fresh.length >= limit) {
        hits.delete(key);
        hits.set(key, fresh);
        return { ok: false, retryAfterMs: fresh[0] + windowMs - t };
      }
      fresh.push(t);
      hits.delete(key); // re-insert so Map order tracks recency of last hit
      hits.set(key, fresh);
      while (hits.size > maxKeys) {
        const oldest = hits.keys().next().value as string;
        hits.delete(oldest);
      }
      return { ok: true, retryAfterMs: 0 };
    },
    size: () => hits.size,
  };
}
