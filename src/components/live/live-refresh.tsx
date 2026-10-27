"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { useLiveEvents } from "@/lib/events/use-live-events";
import { ConnectionIndicator } from "./connection-indicator";
import { cancelRefresh, REFRESH_DEBOUNCE_MS, requestRefresh } from "./shared-refresh";

export { REFRESH_DEBOUNCE_MS };

/**
 * Drop into a staff page: any order, stock or delay event, resync or reconnect re-runs the server components via
 * `router.refresh()` (trailing debounce shared with the heartbeat, so a burst refreshes once).
 * Renders the connection indicator unless `indicator={false}`.
 */
export function LiveRefresh({ indicator = true, large = false, dark = false }: { indicator?: boolean; large?: boolean; dark?: boolean }) {
  const router = useRouter();
  const refresh = useCallback(() => requestRefresh(router), [router]);
  useEffect(() => cancelRefresh, []);

  const state = useLiveEvents({ onOrders: refresh, onDelay: refresh, onStock: refresh, onResync: refresh });

  // Anything that happened between the server render and the stream opening was not announced:
  // catch up once, the first time the connection is live.
  const caughtUp = useRef(false);
  useEffect(() => {
    if (state !== "live" || caughtUp.current) return;
    caughtUp.current = true;
    refresh();
  }, [state, refresh]);
  return indicator ? <ConnectionIndicator state={state} large={large} dark={dark} /> : null;
}
