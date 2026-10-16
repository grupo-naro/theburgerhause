import type { PrintState } from "@/lib/orders/caja-queries";

export type PrintStatus = "printing" | "done" | "failed" | "waiting";

export const PRINT_POLL_INTERVAL_MS = 2_000;
export const PRINT_POLL_TIMEOUT_MS = 30_000;

/** An unhandled failure wins; nothing pending and something printed = done; otherwise still printing. */
export function printStatusOf(state: PrintState): Exclude<PrintStatus, "waiting"> {
  if (state.failed > 0) return "failed";
  if (state.pending === 0 && state.done > 0) return "done";
  return "printing";
}

export type PrintPollerDeps = {
  fetchState: () => Promise<PrintState>;
  /** Called only when the status CHANGES. */
  onStatus: (status: PrintStatus) => void;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
  now: () => number;
  intervalMs?: number;
  timeoutMs?: number;
};

/**
 * Polls the print state of ONE order: immediately, then every 2 s, never two requests at once.
 * Stops on done / failed, and after ~30 s reports `waiting` (the agent has not confirmed: the UI
 * offers a reprint). A failed request is simply retried on the next tick. Pure: timers injected.
 */
export function createPrintPoller(deps: PrintPollerDeps) {
  const interval = deps.intervalMs ?? PRINT_POLL_INTERVAL_MS;
  const timeout = deps.timeoutMs ?? PRINT_POLL_TIMEOUT_MS;
  let startedAt = 0;
  let timer: unknown = null;
  let stopped = false;
  let started = false;
  let last: PrintStatus | null = null;

  const emit = (status: PrintStatus) => {
    if (status === last) return;
    last = status;
    deps.onStatus(status);
  };

  function stop() {
    stopped = true;
    if (timer !== null) deps.cancel(timer);
    timer = null;
  }

  async function tick() {
    timer = null;
    if (stopped) return;
    let status: PrintStatus | null = null;
    try {
      status = printStatusOf(await deps.fetchState());
    } catch {
      status = null; // retry on the next tick
    }
    if (stopped) return;
    if (status === "done" || status === "failed") {
      emit(status);
      return stop();
    }
    if (status) emit(status);
    if (deps.now() - startedAt >= timeout) {
      emit("waiting");
      return stop();
    }
    timer = deps.schedule(() => void tick(), interval);
  }

  return {
    start() {
      if (started) return;
      started = true;
      startedAt = deps.now();
      void tick();
    },
    stop,
  };
}
