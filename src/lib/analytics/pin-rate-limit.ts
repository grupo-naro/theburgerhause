import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";

const WINDOW_MS = 15 * 60 * 1000;

/**
 * Failed analytics-PIN attempts per user (wrong PIN on unlock, wrong password when setting the PIN).
 * Only failures count, like login-rate-limit.ts. In-memory, single instance.
 */
export const PIN_FAILURE_LIMIT = 5;

const g = globalThis as unknown as { __analyticsPinLimiter?: RateLimiter };
const limiter = () => (g.__analyticsPinLimiter ??= createRateLimiter({ limit: PIN_FAILURE_LIMIT, windowMs: WINDOW_MS }));

export function isPinBlocked(userId: number): { blocked: boolean; retryAfterMs: number } {
  const r = limiter().peek(String(userId));
  return { blocked: !r.ok, retryAfterMs: r.retryAfterMs };
}

export function recordPinFailure(userId: number): void {
  limiter().record(String(userId));
}

/** Test hook: forget all counters. */
export function resetPinRateLimit(): void {
  g.__analyticsPinLimiter = undefined;
}
