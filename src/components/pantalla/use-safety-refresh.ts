"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { requestRefresh } from "@/components/live/shared-refresh";
import { createHeartbeat } from "@/lib/caja/heartbeat";

/** A TV left on for days must never stay stale: re-render the server data at least this often. */
export const SAFETY_REFRESH_MS = 60_000;

/**
 * Safety net on top of the live connection (LiveRefresh already refreshes on every event and reconnect): a refresh
 * every 60 s while visible, as soon as the page becomes visible again, and when the network comes back (`online`).
 * Opens no connection; shares LiveRefresh's debounce, so bursts refresh once.
 */
export function useSafetyRefresh(): void {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => requestRefresh(router);
    const hb = createHeartbeat({
      intervalMs: SAFETY_REFRESH_MS,
      schedule: (fn, ms) => window.setTimeout(fn, ms),
      cancel: (h) => window.clearTimeout(h as number),
      isVisible: () => document.visibilityState === "visible",
      onTick: refresh,
    });
    const onVisibility = () => hb.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", refresh);
    hb.start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", refresh);
      hb.stop();
    };
  }, [router]);
}
