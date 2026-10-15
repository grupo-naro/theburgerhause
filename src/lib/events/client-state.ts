import type { OrdersEvent } from "./channels";

/**
 * Pure connection policy of the browser side of /api/events (no DOM, no React): the EventSource,
 * timers and callbacks are injected, so the unit tests drive it with a fake source and clock.
 *
 *  - state: connecting | live | offline (offline = not live for more than OFFLINE_AFTER_MS);
 *  - every open that follows a failure calls onResync (a NOTIFY may have been missed meanwhile);
 *  - while offline, a fallback poll calls onResync every FALLBACK_POLL_MS until live again;
 *  - if the browser gives up on the source (readyState CLOSED, e.g. after a 429) it is reopened
 *    after RETRY_MS, mirroring the server's `retry:` hint.
 */

export const OFFLINE_AFTER_MS = 10_000;
export const FALLBACK_POLL_MS = 15_000;
export const RETRY_MS = 3_000;
export const MAX_RETRY_MS = 60_000;
/** After this many consecutive CLOSED failures (e.g. auth lost) the fallback poll stops: it cannot succeed either. */
export const GIVE_UP_POLLING_AFTER = 5;

export type LiveState = "connecting" | "live" | "offline";

export type EventSourceLike = {
  readyState: number;
  addEventListener(type: string, listener: (event: { data?: string }) => void): void;
  close(): void;
};

export type LiveClientDeps = {
  url: string;
  createSource: (url: string) => EventSourceLike;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
  onOrders?: (event: OrdersEvent) => void;
  onResync?: () => void;
  onState?: (state: LiveState) => void;
};

export type LiveClient = { start(): void; stop(): void; state(): LiveState };

const CLOSED = 2;

function parseOrders(data: string | undefined): OrdersEvent | null {
  if (typeof data !== "string") return null;
  try {
    const v = JSON.parse(data) as Partial<OrdersEvent> | null;
    if (v && typeof v.orderId === "number" && typeof v.status === "string" && typeof v.event === "string") {
      return v as OrdersEvent;
    }
  } catch {
    // fall through
  }
  return null;
}

export function createLiveClient(deps: LiveClientDeps): LiveClient {
  let state: LiveState = "connecting";
  let source: EventSourceLike | null = null;
  let started = false;
  let stopped = false;
  let needResync = false;
  let closedFailures = 0;
  let offlineTimer: unknown = null;
  let fallbackTimer: unknown = null;
  let reopenTimer: unknown = null;
  const has = (h: unknown) => h !== null;

  function setState(next: LiveState) {
    if (state === next) return;
    state = next;
    deps.onState?.(next);
  }

  function clearTimers() {
    if (has(offlineTimer)) deps.cancel(offlineTimer);
    if (has(fallbackTimer)) deps.cancel(fallbackTimer);
    if (has(reopenTimer)) deps.cancel(reopenTimer);
    offlineTimer = fallbackTimer = reopenTimer = null;
  }

  function armFallback() {
    fallbackTimer = deps.schedule(() => {
      fallbackTimer = null;
      if (stopped || state === "live" || closedFailures >= GIVE_UP_POLLING_AFTER) return;
      deps.onResync?.();
      armFallback();
    }, FALLBACK_POLL_MS);
  }

  function armOffline() {
    if (has(offlineTimer) || state === "offline") return;
    offlineTimer = deps.schedule(() => {
      offlineTimer = null;
      if (stopped || state === "live") return;
      setState("offline");
      armFallback();
    }, OFFLINE_AFTER_MS);
  }

  function open() {
    if (stopped) return;
    reopenTimer = null;
    const s = deps.createSource(deps.url);
    source = s;
    const current = () => !stopped && source === s;

    s.addEventListener("open", () => {
      if (!current()) return;
      clearTimers();
      closedFailures = 0;
      setState("live");
      if (needResync) {
        needResync = false;
        deps.onResync?.();
      }
    });
    s.addEventListener("error", () => {
      if (!current()) return;
      needResync = true;
      if (state === "live") setState("connecting");
      armOffline();
      if (s.readyState === CLOSED) {
        s.close();
        source = null;
        closedFailures++;
        if (closedFailures >= GIVE_UP_POLLING_AFTER) {
          if (has(fallbackTimer)) deps.cancel(fallbackTimer);
          fallbackTimer = null;
          setState("offline");
        }
        const delay = Math.min(RETRY_MS * 2 ** (closedFailures - 1), MAX_RETRY_MS);
        if (!has(reopenTimer)) reopenTimer = deps.schedule(open, delay);
      }
    });
    s.addEventListener("orders", (e) => {
      if (!current()) return;
      const ev = parseOrders(e.data);
      if (ev) deps.onOrders?.(ev);
    });
    s.addEventListener("resync", () => {
      if (current()) deps.onResync?.();
    });
  }

  return {
    start() {
      if (started) return;
      started = true;
      deps.onState?.(state);
      armOffline();
      open();
    },
    stop() {
      stopped = true;
      clearTimers();
      source?.close();
      source = null;
    },
    state: () => state,
  };
}
