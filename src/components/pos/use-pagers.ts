"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listActivePagersAction } from "@/app/(staff)/mostrador/actions";
import type { ActivePager } from "@/lib/orders/pagers";

export const PAGERS_POLL_MS = 30_000;

/**
 * The pagers held by active counter orders. Fed three ways, newest wins:
 *  - the server render (`initial`): the staff shell's LiveRefresh re-runs the page on every order
 *    event, so this list follows the SSE stream without a second EventSource;
 *  - `refresh()` (after each sale / a PAGER_IN_USE answer);
 *  - a 30 s poll and a refresh when the tab becomes visible again.
 */
export function usePagers(initial: ActivePager[]) {
  const [list, setList] = useState(initial);
  const [seenInitial, setSeenInitial] = useState(initial);
  const seq = useRef(0);
  if (initial !== seenInitial) {
    // A fresh server render: adopt it.
    setSeenInitial(initial);
    setList(initial);
  }

  const refresh = useCallback(async () => {
    const id = ++seq.current;
    try {
      const r = await listActivePagersAction();
      if (id === seq.current && r.ok) setList(r.data);
    } catch {
      // keep the last known list; the next tick retries
    }
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), PAGERS_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { pagers: list, refresh };
}
