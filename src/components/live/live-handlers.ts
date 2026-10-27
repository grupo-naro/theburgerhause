import type { UseLiveEventsOptions } from "@/lib/events/use-live-events";

/** Which events a LiveRefresh reacts to: everything (staff screens) or only stock changes (admin area). */
export type LiveScope = "all" | "stock";

/** Handlers for `useLiveEvents`; resync (reconnect catch-up) always refreshes. */
export function liveHandlers(scope: LiveScope, refresh: () => void): UseLiveEventsOptions {
  return scope === "stock"
    ? { onStock: refresh, onResync: refresh }
    : { onOrders: refresh, onDelay: refresh, onStock: refresh, onResync: refresh };
}
