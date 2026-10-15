export type RateLimitResult = { ok: boolean; retryAfterMs: number };

export type RateLimiter = {
  /** Records an attempt for `key` (only while allowed) and says whether it may proceed. */
  check(key: string): RateLimitResult;
  /** Says whether `key` could proceed WITHOUT recording anything. */
  peek(key: string): RateLimitResult;
  /** Records a hit for `key` unconditionally (an event that already happened). */
  record(key: string): void;
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

  function fresh(key: string, t: number): number[] {
    return (hits.get(key) ?? []).filter((h) => h > t - windowMs);
  }

  function store(key: string, list: number[]): void {
    hits.delete(key); // re-insert so Map order tracks recency of last hit
    hits.set(key, list);
    while (hits.size > maxKeys) {
      const oldest = hits.keys().next().value as string;
      hits.delete(oldest);
    }
  }

  function verdict(list: number[], t: number): RateLimitResult {
    return list.length >= limit ? { ok: false, retryAfterMs: list[0] + windowMs - t } : { ok: true, retryAfterMs: 0 };
  }

  return {
    check(key) {
      const t = now();
      sweep(t);
      const list = fresh(key, t);
      const v = verdict(list, t);
      if (v.ok) list.push(t);
      store(key, list);
      return v;
    },
    peek(key) {
      const t = now();
      sweep(t);
      return verdict(fresh(key, t), t);
    },
    record(key) {
      const t = now();
      sweep(t);
      const list = fresh(key, t);
      list.push(t);
      store(key, list);
    },
    size: () => hits.size,
  };
}
