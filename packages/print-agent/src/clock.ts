/** Time source, injectable so retries/backoff/timeouts are testable without real waiting. */
export interface TimerHandle {
  cancel(): void;
}
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number, label?: string): TimerHandle;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout(fn, ms) {
    const t = setTimeout(fn, ms);
    return { cancel: () => clearTimeout(t) };
  },
};

/** Resolves after `ms` on the clock, or as soon as `signal` aborts (it never rejects). */
export function sleep(clock: Clock, ms: number, label: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const onAbort = () => {
      handle.cancel();
      resolve();
    };
    const handle = clock.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms, label);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type Rng = () => number;

/** Exponential backoff 1 s -> 30 s with up to 25% jitter. `attempt` starts at 0. */
export function backoffDelay(attempt: number, rng: Rng): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 20));
  return base + Math.floor(rng() * base * 0.25);
}
