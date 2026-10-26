"use client";

import { useEffect } from "react";
import { recoveryState } from "@/components/pantalla/recovery-state";
import { recoveryStep } from "@/lib/pantalla/recovery";

/**
 * The counter TV's error screen. Nobody is there to press "Reintentar": it retries in place by itself (5 s, then every
 * 15 s) and, if that keeps failing, reloads the whole page every 15 s until the server answers again. It shows only a
 * discreet "Reconectando…" on the TV's dark background: no error text, no stack, no data.
 */
export default function PantallaError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[pantalla] render failed", error.digest ?? "");
  }, [error]);

  useEffect(() => {
    recoveryState.attempts += 1;
    const step = recoveryStep(recoveryState.attempts);
    let id = 0;
    const act = () => {
      // Reloading while offline lands on the browser's own error page: wait for the network instead.
      if (navigator.onLine === false) {
        id = window.setTimeout(act, step.delayMs);
        return;
      }
      if (step.action === "retry") retry();
      else window.location.reload();
    };
    id = window.setTimeout(act, step.delayMs);
    return () => window.clearTimeout(id);
  }, [retry]);

  return (
    <div data-tv-board="" className="fixed inset-0 grid place-items-center bg-[#0b1220] text-white">
      <p data-testid="pantalla-reconnecting" role="status" className="font-display text-[4vh] font-bold text-white/70">
        Reconectando…
      </p>
    </div>
  );
}
