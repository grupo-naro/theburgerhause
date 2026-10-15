export type Backoff = { minMs: number; maxMs: number };

export const DEFAULT_BACKOFF: Backoff = { minMs: 1_000, maxMs: 30_000 };

/** Delay before reconnect attempt number `attempt` (0-based): min, 2*min, 4*min, ... capped at max. */
export function reconnectDelay(attempt: number, { minMs, maxMs }: Backoff = DEFAULT_BACKOFF): number {
  if (!Number.isFinite(attempt) || attempt <= 0) return minMs;
  return Math.min(minMs * 2 ** Math.min(attempt, 30), maxMs);
}
