import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";

/**
 * Limits of the public status endpoint (in memory, per process, keyed by the client IP).
 *  - REQUESTS: 60 per minute per IP (the poller asks every 8 s, so ~8/min per open tab).
 *  - MISSES: 30 unknown-token lookups per 10 minutes per IP. Only lookups that found nothing are
 *    recorded, so a customer polling a real order never spends it; someone guessing tokens does.
 */
const REQUESTS = 60;
const REQUESTS_WINDOW_MS = 60 * 1000;
const MISSES = 30;
const MISSES_WINDOW_MS = 10 * 60 * 1000;

type Limiters = { requests: RateLimiter; misses: RateLimiter };

// On globalThis so dev-mode module reloads do not reset the counters.
const g = globalThis as unknown as { __trackingLimiters?: Limiters };
function limiters(): Limiters {
  return (g.__trackingLimiters ??= {
    requests: createRateLimiter({ limit: REQUESTS, windowMs: REQUESTS_WINDOW_MS }),
    misses: createRateLimiter({ limit: MISSES, windowMs: MISSES_WINDOW_MS }),
  });
}

/** Counts this request. `retryAfterMs` is meaningful when not ok. */
export function checkTrackingRequest(ip: string): { ok: boolean; retryAfterMs: number } {
  return limiters().requests.check(ip);
}

/** May this IP still look up tokens? Consumes nothing. */
export function peekTrackingMisses(ip: string): { ok: boolean; retryAfterMs: number } {
  return limiters().misses.peek(ip);
}

/** A lookup found no order: spend one miss. */
export function recordTrackingMiss(ip: string): void {
  limiters().misses.record(ip);
}

/** Test hook: forget all counters. */
export function resetTrackingRateLimit(): void {
  g.__trackingLimiters = undefined;
}
