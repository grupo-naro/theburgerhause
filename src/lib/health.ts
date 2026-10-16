import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { clientIp } from "@/lib/client-ip";
import { listenerStatus } from "@/lib/events/listener";
import { createRateLimiter } from "@/lib/rate-limit";
import pkg from "../../package.json";

/**
 * Logic of GET /api/health (the route file only re-exports it). Public, no auth, never cached.
 * 200 {status:"ok",db:"ok"} when `SELECT 1` answers within the timeout; otherwise
 * 503 {status:"degraded",db:"down"}. The realtime listener state is informational: it never fails the check.
 * It never throws and never echoes error text, connection strings or library versions.
 */

export type HealthOptions = {
  /** Resolves when the database answers; rejects otherwise. */
  checkDb?: () => Promise<unknown>;
  realtime?: () => string;
  commit?: string;
  version?: string;
  timeoutMs?: number;
  /** Requests per minute per client IP. */
  perMinute?: number;
  now?: () => Date;
};

const HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
} as const;

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });

async function withTimeout(work: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    return (await Promise.race([work.then(() => "ok" as const), timeout])) === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    work.catch(() => {}); // a late rejection after the timeout must not become unhandled
  }
}

export function createHealthHandler(options: HealthOptions = {}) {
  const limiter = createRateLimiter({ limit: options.perMinute ?? 60, windowMs: 60_000 });
  const checkDb = options.checkDb ?? (() => getDb().execute(sql`select 1`));
  const timeoutMs = options.timeoutMs ?? 2_000;

  return async function GET(request: Request): Promise<Response> {
    try {
      const verdict = limiter.check(clientIp(request.headers));
      if (!verdict.ok) {
        return json(429, { status: "rate_limited" }, { "Retry-After": String(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000))) });
      }

      let dbOk = false;
      try {
        dbOk = await withTimeout(Promise.resolve().then(checkDb), timeoutMs);
      } catch {
        dbOk = false;
      }
      if (!dbOk) return json(503, { status: "degraded", db: "down" });

      let realtime = "down";
      try {
        realtime = (options.realtime ?? listenerStatus)() === "live" ? "live" : "down";
      } catch {
        realtime = "down";
      }
      const commit = "commit" in options ? options.commit : process.env.APP_COMMIT;
      return json(200, {
        status: "ok",
        db: "ok",
        realtime,
        time: (options.now ?? (() => new Date()))().toISOString(),
        version: options.version ?? pkg.version,
        ...(commit ? { commit } : {}),
      });
    } catch {
      return json(503, { status: "degraded", db: "down" });
    }
  };
}
