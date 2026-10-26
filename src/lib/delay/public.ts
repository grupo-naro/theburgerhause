import type { Db } from "@/db/client";
import { getSettings } from "@/lib/settings";
import { computeEstimate } from "./estimate";
import { getActiveDelay } from "./notices";
import { loadEstimateInputs } from "./queries";

/**
 * What customers may know about the wait: two ranges and whether it is longer than usual.
 * Explicit allow-list: no reason, no ids, no staff names.
 */
export type PublicDelay = {
  takeaway: { low: number; high: number };
  delivery: { low: number; high: number };
  delayed: boolean;
};

export async function getPublicDelay(db: Db, now: Date = new Date()): Promise<PublicDelay> {
  const [inputs, settings, active] = await Promise.all([loadEstimateInputs(db, now), getSettings(db), getActiveDelay(db)]);
  const base = {
    ...inputs,
    baseMinutes: settings.basePrepMinutes,
    travelMinutes: settings.deliveryTravelMinutes,
    manualExtraMinutes: active?.extraMinutes ?? 0,
  };
  const takeaway = computeEstimate({ ...base, fulfillment: "takeaway" });
  const delivery = computeEstimate({ ...base, fulfillment: "delivery" });
  return {
    takeaway: { low: takeaway.low, high: takeaway.high },
    delivery: { low: delivery.low, high: delivery.high },
    delayed: takeaway.delayed || delivery.delayed,
  };
}
