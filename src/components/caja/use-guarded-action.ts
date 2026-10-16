"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { createActionGuard } from "@/lib/ui/action-guard";
import type { DispatchFailureDetail } from "@/lib/orders/dispatch";

/** Structural result of any staff Server Action (Caja and Despacho share this shape). */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; details?: DispatchFailureDetail[] };

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
  const guard = useRef(createActionGuard()).current;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    <T,>(call: () => Promise<ActionResult<T>>, handlers: Handlers<T> = {}) => {
      if (!guard.tryStart()) return;
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
          guard.finish(keepLocked);
        }
      });
    },
    [guard],
  );

  const release = useCallback(() => {
    guard.release();
  }, [guard]);

  return { run, pending, error, clearError: () => setError(null), release };
}
