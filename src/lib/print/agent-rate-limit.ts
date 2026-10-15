import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";

/**
 * Failed agent authentications per client IP: 30 per 10 minutes (in memory, per process).
 * Only FAILURES are recorded; a valid token never spends the budget (nine agents behind one venue IP).
 */
export const AUTH_FAILURES_LIMIT = 30;
const WINDOW_MS = 10 * 60 * 1000;

const g = globalThis as unknown as { __bhAgentAuthLimiter?: RateLimiter };
const limiter = (): RateLimiter => (g.__bhAgentAuthLimiter ??= createRateLimiter({ limit: AUTH_FAILURES_LIMIT, windowMs: WINDOW_MS }));

/** Counts one failed attempt; `ok: false` means this IP is over budget (answer 429 + Retry-After). */
export function recordAgentAuthFailure(ip: string): { ok: boolean; retryAfterMs: number } {
  return limiter().check(ip);
}

/** Test hook. */
export function resetAgentRateLimit(): void {
  g.__bhAgentAuthLimiter = undefined;
}
