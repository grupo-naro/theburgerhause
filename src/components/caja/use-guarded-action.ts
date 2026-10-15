"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/app/(staff)/caja/actions";

const GENERIC_ERROR = "No se pudo completar la acción. Probá de nuevo.";

type Handlers<T> = {
  onOk?: (data: T) => void;
  onFail?: (failure: Extract<ActionResult<T>, { ok: false }>) => void;
  /** Keep the guard closed after a success (the card is about to leave). */
  lockOnSuccess?: boolean;
};

/**
 * Runs a Server Action at most once at a time. `inFlight` is a ref so a second click in the same
 * frame (before React re-renders the disabled state) is dropped synchronously.
 */
export function useGuardedAction() {
  const inFlight = useRef(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    <T,>(call: () => Promise<ActionResult<T>>, handlers: Handlers<T> = {}) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setError(null);
      startTransition(async () => {
        let keepLocked = false;
        try {
          const result = await call();
          if (result.ok) {
            keepLocked = handlers.lockOnSuccess === true;
            handlers.onOk?.(result.data);
          } else {
            setError(result.message);
            handlers.onFail?.(result);
          }
        } catch {
          setError(GENERIC_ERROR);
        } finally {
          if (!keepLocked) inFlight.current = false;
        }
      });
    },
    [],
  );

  return { run, pending, error, clearError: () => setError(null) };
}
