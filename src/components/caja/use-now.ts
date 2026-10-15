"use client";

import { useEffect, useState } from "react";

export const TICK_MS = 30_000;

/**
 * A wall clock that ticks every 30 s. It starts from the server's `now` (so the first client
 * render matches the HTML) and never goes backwards when a later refresh brings an older value.
 */
export function useNow(serverNowIso: string): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);
  return Math.max(tick, Date.parse(serverNowIso));
}
