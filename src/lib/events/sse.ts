import { randomUUID } from "node:crypto";
import { getDb } from "@/db/client";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession, type Role } from "@/lib/auth/roles";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { validateSessionToken } from "@/lib/auth/session-store";
import { subscribe } from "./bus";
import { ORDERS_CHANNEL } from "./channels";

/**
 * Server half of GET /api/events (the route file only re-exports it: route modules may not export
 * anything else). Protocol: `retry: 3000`, `event: hello`, then `event: orders` / `event: resync`
 * frames and a `: ping` comment every 25 s. print_job_created is deliberately NOT forwarded.
 */

export const STAFF_ROLES: Role[] = ["admin", "cajera", "encargada_delivery"];
export const RETRY_MS = 3_000;

export type EventsHandlerOptions = {
  pingMs?: number;
  revalidateMs?: number;
  perUserCap?: number;
  globalCap?: number;
  /** Chunks a slow client may have queued before we start dropping events (then one resync). */
  queueSize?: number;
  /** True while the session behind `request` is still valid for `session.user`. */
  revalidate?: (request: Request, session: AuthSession) => Promise<boolean>;
};

// Connection counters live on globalThis (see bus.ts for why).
type Counters = { total: number; byUser: Map<number, number> };
const g = globalThis as unknown as { __bhSseCounters?: Counters };
const counters = (): Counters => (g.__bhSseCounters ??= { total: 0, byUser: new Map() });

export function connectionStats(): { total: number; byUser: Record<number, number> } {
  const c = counters();
  return { total: c.total, byUser: Object.fromEntries(c.byUser) };
}

export function resetConnectionStats(): void {
  g.__bhSseCounters = undefined;
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * Re-checks the session straight from the request's cookie (cookies() is request-scoped and not
 * reliable from a timer long after the response started). The stream is NOT user activity: it
 * validates WITHOUT sliding, so the 12 h inactivity limit still ends it (reconnect then gets a 401).
 */
export async function defaultRevalidate(request: Request, session: AuthSession): Promise<boolean> {
  const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return false;
  const fresh = await validateSessionToken(getDb(), token, new Date(), { slide: false });
  return fresh !== null && fresh.user.id === session.user.id && STAFF_ROLES.includes(fresh.user.role);
}

const json = (status: number, error: string, headers?: Record<string, string>) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });

export function createEventsHandler(opts: EventsHandlerOptions = {}): (request: Request) => Promise<Response> {
  const {
    pingMs = 25_000,
    revalidateMs = 60_000,
    perUserCap = 10,
    globalCap = 200,
    queueSize = 16,
    revalidate = defaultRevalidate,
  } = opts;

  return async function GET(request: Request): Promise<Response> {
    let session: AuthSession;
    try {
      session = await requireRole(...STAFF_ROLES);
    } catch (err) {
      if (err instanceof AuthError) {
        return err.code === "UNAUTHENTICATED" ? json(401, "authentication required") : json(403, "forbidden");
      }
      throw err;
    }

    const userId = session.user.id;
    const c = counters();
    if (c.total >= globalCap || (c.byUser.get(userId) ?? 0) >= perUserCap) {
      return json(429, "too many live connections", { "Retry-After": "5" });
    }
    c.total++;
    c.byUser.set(userId, (c.byUser.get(userId) ?? 0) + 1);

    const enc = new TextEncoder();
    let closed = false;
    let needResync = false;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cleanups: Array<() => void> = [];

    /** Idempotent; the single place that releases subscriptions, timers and counters. */
    const close = () => {
      if (closed) return;
      closed = true;
      for (const fn of cleanups.splice(0)) fn();
      request.signal.removeEventListener("abort", close);
      const cur = counters();
      cur.total = Math.max(0, cur.total - 1);
      const left = (cur.byUser.get(userId) ?? 1) - 1;
      if (left <= 0) cur.byUser.delete(userId);
      else cur.byUser.set(userId, left);
      try {
        controller.close();
      } catch {
        // already closed / cancelled by the client
      }
    };

    const hasRoom = () => (controller.desiredSize ?? 0) > 0;
    const enqueue = (frame: string) => controller.enqueue(enc.encode(frame));
    const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    /** Sends a frame unless the client is not keeping up; then remember to resync it later. */
    const send = (text: string) => {
      if (closed) return;
      if (!hasRoom()) {
        needResync = true;
        return;
      }
      if (needResync) {
        needResync = false;
        enqueue(frame("resync", {}));
        if (!hasRoom()) {
          needResync = true; // the resync took the last slot; the event below would be dropped anyway
          return;
        }
      }
      enqueue(text);
    };

    const stream = new ReadableStream<Uint8Array>(
      {
        start(ctrl) {
          controller = ctrl;
          enqueue(`retry: ${RETRY_MS}\n\n`);
          enqueue(frame("hello", { serverTime: new Date().toISOString(), connectionId: randomUUID() }));

          cleanups.push(
            subscribe(ORDERS_CHANNEL, (event) => send(frame("orders", event))),
            subscribe("resync", () => send(frame("resync", {}))),
          );

          const ping = setInterval(() => send(": ping\n\n"), pingMs);
          cleanups.push(() => clearInterval(ping));

          let checking = false;
          const check = setInterval(() => {
            if (checking) return;
            checking = true;
            revalidate(request, session)
              .then((ok) => {
                if (!ok) close();
              })
              .catch(() => {
                // Transient failure (e.g. DB hiccup): keep the stream, the next tick retries.
                console.error("[events] session revalidation failed");
              })
              .finally(() => {
                checking = false;
              });
          }, revalidateMs);
          cleanups.push(() => clearInterval(check));
        },
        cancel() {
          close();
        },
      },
      new CountQueuingStrategy({ highWaterMark: queueSize }),
    );

    if (request.signal.aborted) close();
    else request.signal.addEventListener("abort", close, { once: true });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  };
}
