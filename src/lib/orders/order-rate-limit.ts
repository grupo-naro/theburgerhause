import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";

const WINDOW_MS = 10 * 60 * 1000;

/**
 * Two layers, both in memory per process:
 *  - CREATION quotas (strict): count only orders that were actually created. Peeked before
 *    calling createOrder, recorded after a successful NEW creation. Failed attempts (stale
 *    cart, closed store), double clicks and idempotent replays never consume them.
 *    Per IP 20 / 10 min (venue Wi-Fi and CGNAT share one IP), per whatsapp 3 / 10 min.
 *  - ATTEMPT limiter (loose): 60 requests / 10 min per IP of ANY kind (valid or not,
 *    replays included). It bounds the DB cost of a request, nothing else. It replaces a
 *    separate replay limiter: one simple limit covers every request.
 *
 * The client IP is the LAST x-forwarded-for hop (see client-ip.ts). Behind the documented
 * Nginx config the header always exists; if it is ever absent every caller falls into the
 * single "unknown" bucket, i.e. they share the limits (fail-closed, never unlimited).
 */
const IP_CREATIONS = 20;
const WHATSAPP_CREATIONS = 3;
const ATTEMPTS = 60;

type Limiters = { attempts: RateLimiter; ip: RateLimiter; whatsapp: RateLimiter };

// Kept on globalThis so dev-mode module reloads do not reset the counters.
const g = globalThis as unknown as { __orderLimiters?: Limiters };
function limiters(): Limiters {
  return (g.__orderLimiters ??= {
    attempts: createRateLimiter({ limit: ATTEMPTS, windowMs: WINDOW_MS }),
    ip: createRateLimiter({ limit: IP_CREATIONS, windowMs: WINDOW_MS }),
    whatsapp: createRateLimiter({ limit: WHATSAPP_CREATIONS, windowMs: WINDOW_MS }),
  });
}

/** Counts this request against the loose per-IP attempt limit. */
export function checkAttempt(ip: string): { ok: boolean } {
  return { ok: limiters().attempts.check(ip).ok };
}

/** Would one more NEW order from this IP / whatsapp (digits) be allowed? Consumes nothing. */
export function canCreate(ip: string, whatsappDigits: string): { ok: boolean } {
  const { ip: byIp, whatsapp } = limiters();
  return { ok: byIp.peek(ip).ok && whatsapp.peek(whatsappDigits).ok };
}

/** An order was created: consume one creation slot of each. */
export function recordCreation(ip: string, whatsappDigits: string): void {
  const { ip: byIp, whatsapp } = limiters();
  byIp.record(ip);
  whatsapp.record(whatsappDigits);
}

/** Test hook: forget all counters. */
export function resetOrderRateLimit(): void {
  g.__orderLimiters = undefined;
}
