import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";

/** /api/demora: 120 per minute per IP (each open tab polls once a minute; this only bounds abuse). */
const LIMIT = 120;
const WINDOW_MS = 60 * 1000;

// On globalThis so dev-mode module reloads do not reset the counters.
const g = globalThis as unknown as { __demoraLimiter?: RateLimiter };

export function checkDemoraRequest(ip: string): { ok: boolean; retryAfterMs: number } {
  return (g.__demoraLimiter ??= createRateLimiter({ limit: LIMIT, windowMs: WINDOW_MS })).check(ip);
}

/** Test hook: forget all counters. */
export function resetDemoraRateLimit(): void {
  g.__demoraLimiter = undefined;
}
