import type { OrderStatus } from "@/domain/order-status";

/**
 * Pure polling policy of the tracking page (no DOM, no fetch, no React): timers, visibility and
 * the network are injected, so the unit tests drive it with a fake clock.
 *
 *  - polls every 8 s while the tab is visible, pauses when hidden;
 *  - refreshes at once when the tab becomes visible again or the browser comes back online;
 *  - never has two requests in flight;
 *  - stops on a terminal status (entregado / cancelado) or when the order no longer exists (404);
 *  - on errors the next delay doubles (16 s, 32 s, 60 s max) and resets after a success.
 */

export const POLL_INTERVAL_MS = 8_000;
export const MAX_BACKOFF_MS = 60_000;

export type PaymentStatus = "pending" | "paid";
export type PolledState = { status: OrderStatus; paymentStatus: PaymentStatus };
export type PollResult = ({ kind: "ok" } & PolledState) | { kind: "gone" } | { kind: "error" };

export const isTerminal = (status: OrderStatus): boolean => status === "entregado" || status === "cancelado";

/** Delay before the next poll after `failures` consecutive failures. */
export function backoffDelay(failures: number): number {
  if (failures <= 0) return POLL_INTERVAL_MS;
  return Math.min(POLL_INTERVAL_MS * 2 ** Math.min(failures, 10), MAX_BACKOFF_MS);
}

export type PollerDeps = {
  initial: PolledState;
  /** Resolves with the outcome of one request; a rejection counts as an error. */
  fetchStatus: () => Promise<PollResult>;
  /** Called when the status or the payment status differs from the last known one. */
  onChange: (next: PolledState) => void;
  isVisible: () => boolean;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
};

export type Poller = {
  start(): void;
  stop(): void;
  /** Call on every `visibilitychange`. */
  visibilityChanged(): void;
  /** Call on the `online` event. */
  online(): void;
};

export function createPoller(deps: PollerDeps): Poller {
  let current = deps.initial;
  let failures = 0;
  let timer: unknown = null;
  let inFlight = false;
  let started = false;
  let stopped = false;

  function clearTimer() {
    if (timer !== null) deps.cancel(timer);
    timer = null;
  }

  function scheduleNext(ms: number) {
    clearTimer();
    if (stopped || !deps.isVisible()) return;
    timer = deps.schedule(() => {
      timer = null;
      void tick();
    }, ms);
  }

  function stop() {
    stopped = true;
    clearTimer();
  }

  async function tick() {
    if (stopped || inFlight || !deps.isVisible()) return;
    inFlight = true;
    let result: PollResult;
    try {
      result = await deps.fetchStatus();
    } catch {
      result = { kind: "error" };
    }
    inFlight = false;
    if (stopped) return;

    if (result.kind === "gone") return stop();
    if (result.kind === "error") {
      failures += 1;
      return scheduleNext(backoffDelay(failures));
    }
    failures = 0;
    if (result.status !== current.status || result.paymentStatus !== current.paymentStatus) {
      current = { status: result.status, paymentStatus: result.paymentStatus };
      deps.onChange(current);
    }
    if (isTerminal(current.status)) return stop();
    scheduleNext(POLL_INTERVAL_MS);
  }

  /** A poll right now (the pending timer, if any, is replaced by the one the response schedules). */
  function pollNow() {
    if (!started || stopped || inFlight || !deps.isVisible()) return;
    clearTimer();
    void tick();
  }

  return {
    start() {
      if (started) return;
      started = true;
      if (isTerminal(current.status)) return stop();
      scheduleNext(POLL_INTERVAL_MS);
    },
    stop,
    visibilityChanged() {
      if (!deps.isVisible()) clearTimer();
      else pollNow();
    },
    online: pollNow,
  };
}
