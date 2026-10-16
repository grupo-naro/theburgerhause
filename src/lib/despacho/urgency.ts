import type { Urgency } from "@/lib/caja/elapsed";

export type UrgencyLane = "preparing" | "ready" | "pickup" | "enRoute";

/**
 * Minutes IN THE CURRENT STATUS after which a card turns amber ("Demora") and red ("Urgente"):
 * preparing counts from the approval, ready from the "Listo" click, pickup from the call (the
 * customer is at the counter), en route from the cadet assignment.
 */
export const URGENCY_THRESHOLDS_MIN: Record<UrgencyLane, { warning: number; urgent: number }> = {
  preparing: { warning: 10, urgent: 15 },
  ready: { warning: 5, urgent: 10 },
  pickup: { warning: 5, urgent: 10 },
  enRoute: { warning: 30, urgent: 45 },
};

const MIN = 60_000;

/** Whole minutes between an ISO time and `nowMs`; 0 for the future or an unparsable date. */
export function minutesSince(iso: string, nowMs: number): number {
  const start = Date.parse(iso);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((nowMs - start) / MIN));
}

/** Urgency of an order given WHEN IT ENTERED its current status (`statusSince`). */
export function orderUrgency(lane: UrgencyLane, statusSinceIso: string, nowMs: number): Urgency {
  const start = Date.parse(statusSinceIso);
  if (Number.isNaN(start)) return "normal";
  const elapsed = nowMs - start;
  const t = URGENCY_THRESHOLDS_MIN[lane];
  if (elapsed >= t.urgent * MIN) return "urgent";
  if (elapsed >= t.warning * MIN) return "warning";
  return "normal";
}
