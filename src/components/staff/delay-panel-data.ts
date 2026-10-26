import type { Db } from "@/db/client";
import { computeEstimate, type Estimate } from "@/lib/delay/estimate";
import { getActiveDelay, type ActiveDelay } from "@/lib/delay/notices";
import { loadEstimateInputs } from "@/lib/delay/queries";
import { getSettings } from "@/lib/settings";

export type DelayPanelData = {
  /** What the system estimates by itself (kitchen load only, no manual notice). */
  auto: { takeaway: Estimate; delivery: Estimate; inPreparation: number };
  active: ActiveDelay | null;
};

export async function getDelayPanelData(db: Db, now: Date): Promise<DelayPanelData> {
  const [inputs, settings, active] = await Promise.all([loadEstimateInputs(db, now), getSettings(db), getActiveDelay(db)]);
  const base = {
    ...inputs,
    baseMinutes: settings.basePrepMinutes,
    travelMinutes: settings.deliveryTravelMinutes,
    manualExtraMinutes: 0,
  };
  return {
    auto: {
      takeaway: computeEstimate({ ...base, fulfillment: "takeaway" }),
      delivery: computeEstimate({ ...base, fulfillment: "delivery" }),
      inPreparation: inputs.inPreparation,
    },
    active,
  };
}
