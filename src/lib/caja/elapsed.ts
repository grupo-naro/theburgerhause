/** Waiting-time helpers of the Caja cards. Pure: the clock is always injected. */

export type Urgency = "normal" | "warning" | "urgent";

const MIN = 60_000;
export const WARNING_AFTER_MS = 5 * MIN;
export const URGENT_AFTER_MS = 10 * MIN;

/** Milliseconds since `createdAtIso`; never negative (clock skew) and 0 for an unparsable date. */
export function elapsedMs(createdAtIso: string, now: Date): number {
  const created = Date.parse(createdAtIso);
  if (Number.isNaN(created)) return 0;
  return Math.max(0, now.getTime() - created);
}

/** < 5 min normal; 5:00 up to and including 10:00 warning (demora); beyond 10:00 urgent. */
export function urgencyOf(ms: number): Urgency {
  if (ms > URGENT_AFTER_MS) return "urgent";
  if (ms >= WARNING_AFTER_MS) return "warning";
  return "normal";
}

/** "recién" under a minute, then "hace 4 min", "hace 1 h", "hace 1 h 5 min". */
export function formatElapsed(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MIN);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `hace ${h} h` : `hace ${h} h ${m} min`;
}
