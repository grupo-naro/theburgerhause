"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useGuardedAction, type ActionResult } from "@/components/caja/use-guarded-action";

/** SSE normally moves the card first; this covers a stalled stream. */
const REFRESH_AFTER_ACTION_MS = 1500;
/** If the card is still there after the refresh (nothing moved), give the buttons back. */
const UNLOCK_AFTER_MS = 4000;

/**
 * One card's mutation: runs a Server Action at most once at a time (synchronous guard), keeps the
 * buttons disabled while it runs and until the card leaves, and on a state conflict (another
 * person got there first) shows the server's message inline and refreshes the board.
 */
export function useCardAction() {
  const router = useRouter();
  const { run, pending, error, clearError, release } = useGuardedAction();
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((h) => window.clearTimeout(h));
  }, []);

  const exec = useCallback(
    <T,>(call: () => Promise<ActionResult<T>>, onOk?: (data: T) => void) =>
      run(call, {
        lockOnSuccess: true,
        onOk: (data) => {
          onOk?.(data);
          setLeaving(true);
          timers.current.push(
            window.setTimeout(() => router.refresh(), REFRESH_AFTER_ACTION_MS),
            window.setTimeout(() => {
              setLeaving(false);
              release();
            }, UNLOCK_AFTER_MS),
          );
        },
        onFail: (f) => {
          if (f.code === "INVALID_TRANSITION" || f.code === "NOT_FOUND") router.refresh();
        },
      }),
    [run, router, release],
  );

  return { exec, busy: pending || leaving, error, clearError };
}
