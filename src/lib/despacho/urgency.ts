import { elapsedMs, urgencyOf, type Urgency } from "@/lib/caja/elapsed";

export type UrgencyLane = "preparing" | "ready" | "pickup" | "enRoute";

/**
 * Age-based urgency of a card, with the Caja thresholds (5 / 10 min since the order was created).
 * Orders already out with a cadet never escalate: the board has no assignment time and a delivery
 * legitimately takes a while.
 */
export function orderUrgency(lane: UrgencyLane, createdAtIso: string, nowMs: number): Urgency {
  if (lane === "enRoute") return "normal";
  return urgencyOf(elapsedMs(createdAtIso, new Date(nowMs)));
}
