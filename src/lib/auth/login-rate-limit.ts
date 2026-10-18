import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";

const WINDOW_MS = 15 * 60 * 1000;

/**
 * Only FAILED attempts count: the action asks `isLoginBlocked` BEFORE checking the password (that
 * never consumes budget) and calls `recordLoginFailure` when the credentials are wrong. A success
 * costs nothing, so the 9 PCs of the premises (one public IP) can all log in at shift start.
 * Brute force stays bounded: 5 failures / 15 min per ip+username, 60 failures / 15 min per ip
 * (password spraying across usernames).
 */
export const PAIR_FAILURE_LIMIT = 5;
export const IP_FAILURE_LIMIT = 60;

// Kept on globalThis so dev-mode module reloads do not reset the counters.
const g = globalThis as unknown as { __loginFailureLimiters?: { pair: RateLimiter; ip: RateLimiter } };
function limiters() {
  return (g.__loginFailureLimiters ??= {
    pair: createRateLimiter({ limit: PAIR_FAILURE_LIMIT, windowMs: WINDOW_MS }),
    ip: createRateLimiter({ limit: IP_FAILURE_LIMIT, windowMs: WINDOW_MS }),
  });
}

const pairKey = (ip: string, username: string) => `${ip}|${username.trim().toLowerCase()}`;

/** True when this ip or ip+username already used up its failures. Records nothing. */
export function isLoginBlocked(ip: string, username: string): boolean {
  const { pair, ip: byIp } = limiters();
  return !byIp.peek(ip).ok || !pair.peek(pairKey(ip, username)).ok;
}

/** Counts one failed attempt (wrong credentials). */
export function recordLoginFailure(ip: string, username: string): void {
  const { pair, ip: byIp } = limiters();
  byIp.record(ip);
  pair.record(pairKey(ip, username));
}

/** Test hook: forget all counters. */
export function resetLoginRateLimit(): void {
  g.__loginFailureLimiters = undefined;
}
