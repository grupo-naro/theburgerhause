"use client";

import { useCallback, useEffect, useState } from "react";
import { getPrintStateAction } from "@/app/(staff)/mostrador/actions";
import { createPrintPoller, type PolledPrintState, type PrintStatus } from "@/lib/pos/print-poller";

/** Print status of one order, polled every 2 s until done / failed / ~30 s (see `createPrintPoller`). */
export function usePrintStatus(orderId: number) {
  const [status, setStatus] = useState<PrintStatus>("printing");
  const [state, setState] = useState<PolledPrintState | undefined>(undefined);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const poller = createPrintPoller({
      fetchState: async () => {
        const r = await getPrintStateAction({ orderId });
        if (!r.ok) throw new Error(r.code);
        return r.data;
      },
      onStatus: (st, s) => {
        setStatus(st);
        setState(s);
      },
      schedule: (fn, ms) => window.setTimeout(fn, ms),
      cancel: (h) => window.clearTimeout(h as number),
      now: () => Date.now(),
    });
    poller.start();
    return () => poller.stop();
  }, [orderId, run]);

  /** Back to "printing" and poll again (after a reprint). */
  const restart = useCallback(() => {
    setStatus("printing");
    setRun((n) => n + 1);
  }, []);

  /** `state` = the last counts + the ticket kinds that failed / are unconfirmed (to reprint exactly those). */
  return { status, state, restart };
}
