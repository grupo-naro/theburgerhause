import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";

const WINDOW_MS = 15 * 60 * 1000;

// Kept on globalThis so dev-mode module reloads do not reset the counters.
const g = globalThis as unknown as { __loginLimiters?: { pair: RateLimiter; ip: RateLimiter } };
function limiters() {
  return (g.__loginLimiters ??= {
    pair: createRateLimiter({ limit: 5, windowMs: WINDOW_MS }),
    ip: createRateLimiter({ limit: 20, windowMs: WINDOW_MS }),
  });
}

/** 5 attempts / 15 min per ip+username and 20 / 15 min per ip. */
export function checkLoginRate(ip: string, username: string): { ok: boolean } {
  const { pair, ip: byIp } = limiters();
  const a = byIp.check(ip);
  const b = pair.check(`${ip}|${username.trim().toLowerCase()}`);
  return { ok: a.ok && b.ok };
}

/** Test hook: forget all counters. */
export function resetLoginRateLimit(): void {
  g.__loginLimiters = undefined;
}
