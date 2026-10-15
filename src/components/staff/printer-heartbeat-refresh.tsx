"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { requestRefresh } from "@/components/live/shared-refresh";
import { createHeartbeat, HEARTBEAT_MS } from "@/lib/caja/heartbeat";

/**
 * The print agent's heartbeat emits no event, so the printer indicator would go stale in quiet
 * periods. Re-render the server data every 30 s while the tab is visible (and as soon as it becomes
 * visible). Opens no connection; shares the debounce of LiveRefresh.
 */
export function PrinterHeartbeatRefresh() {
  const router = useRouter();
  useEffect(() => {
    const hb = createHeartbeat({
      intervalMs: HEARTBEAT_MS,
      schedule: (fn, ms) => window.setTimeout(fn, ms),
      cancel: (h) => window.clearTimeout(h as number),
      isVisible: () => document.visibilityState === "visible",
      onTick: () => requestRefresh(router),
    });
    const onVisibility = () => hb.visibilityChanged();
    document.addEventListener("visibilitychange", onVisibility);
    hb.start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      hb.stop();
    };
  }, [router]);
  return null;
}
