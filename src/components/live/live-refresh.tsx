"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { createDebounce } from "@/lib/events/debounce";
import { useLiveEvents } from "@/lib/events/use-live-events";
import { ConnectionIndicator } from "./connection-indicator";

export const REFRESH_DEBOUNCE_MS = 250;

/**
 * Drop into a staff page: any order event, resync or reconnect re-runs the server components via
 * `router.refresh()` (trailing debounce, so a burst of events refreshes once). Renders the
 * connection indicator unless `indicator={false}`.
 */
export function LiveRefresh({ indicator = true, large = false }: { indicator?: boolean; large?: boolean }) {
  const router = useRouter();
  const refresh = useMemo(
    () =>
      createDebounce(() => router.refresh(), REFRESH_DEBOUNCE_MS, {
        schedule: (fn, ms) => window.setTimeout(fn, ms),
        cancel: (handle) => window.clearTimeout(handle as number),
      }),
    [router],
  );
  useEffect(() => () => refresh.cancel(), [refresh]);

  const state = useLiveEvents({ onOrders: refresh.call, onResync: refresh.call });
  return indicator ? <ConnectionIndicator state={state} large={large} /> : null;
}
