"use client";

import { useEffect, useState } from "react";
import { serverClockNow } from "@/lib/cocina/clock";

const TICK_MS = 5_000;

/**
 * "Now" for the kitchen ages: the server time of the latest render + the local monotonic time elapsed since (see
 * serverClockNow), so a device clock that is behind (or ahead of) the server cannot freeze or inflate the ages.
 * The monotonic reading is kept in state and refreshed every few seconds (at most that much staleness; ages are minutes).
 */
export function useServerClock(serverNowIso: string): number {
  const serverMs = Date.parse(serverNowIso);
  const [perf, setPerf] = useState(() => performance.now());
  const [base, setBase] = useState(() => ({ serverMs, perf }));
  if (base.serverMs !== serverMs) setBase({ serverMs, perf });
  useEffect(() => {
    const id = window.setInterval(() => setPerf(performance.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return serverClockNow(base.serverMs, base.perf, perf);
}
