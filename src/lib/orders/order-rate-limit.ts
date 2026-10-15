import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";

const WINDOW_MS = 10 * 60 * 1000;

type Limiters = { ip: RateLimiter; whatsapp: RateLimiter; replay: RateLimiter };

// Kept on globalThis so dev-mode module reloads do not reset the counters.
const g = globalThis as unknown as { __orderLimiters?: Limiters };
function limiters(): Limiters {
  return (g.__orderLimiters ??= {
    ip: createRateLimiter({ limit: 5, windowMs: WINDOW_MS }),
    whatsapp: createRateLimiter({ limit: 3, windowMs: WINDOW_MS }),
    // Replays of an already-created order (double click, flaky-network retry) are free of
    // the quotas above but still bounded so the lookup cannot be used to hammer the DB.
    replay: createRateLimiter({ limit: 30, windowMs: WINDOW_MS }),
  });
}

/** New order: 5 / 10 min per IP AND 3 / 10 min per whatsapp (digits). Both are always evaluated. */
export function checkOrderRate(ip: string, whatsappDigits: string): { ok: boolean } {
  const { ip: byIp, whatsapp } = limiters();
  const a = byIp.check(ip);
  const b = whatsapp.check(whatsappDigits);
  return { ok: a.ok && b.ok };
}

/** Replay of an existing order (same idempotency key): 30 / 10 min per IP. */
export function checkReplayRate(ip: string): { ok: boolean } {
  return { ok: limiters().replay.check(ip).ok };
}

/** Test hook: forget all counters. */
export function resetOrderRateLimit(): void {
  g.__orderLimiters = undefined;
}
