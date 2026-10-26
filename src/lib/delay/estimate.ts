import type { Fulfillment } from "@/domain/order-status";
import {
  BLEND_WEIGHT_BASE,
  DELAYED_THRESHOLD,
  FREE_QUEUE,
  MAX_KITCHEN_MINUTES,
  MAX_QUEUE_SURCHARGE,
  MIN_PER_EXTRA_ORDER,
  RANGE_HALF_WIDTH,
  ROUND_TO,
  SAMPLE_WINDOW,
} from "./constants";

export type EstimateInput = {
  samplesMinutes: number[];
  inPreparation: number;
  baseMinutes: number;
  travelMinutes: number;
  manualExtraMinutes: number;
  fulfillment: Fulfillment;
};

/** Minutes, multiples of 5. */
export type Estimate = { low: number; high: number; delayed: boolean };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeEstimate(input: EstimateInput): Estimate {
  const { samplesMinutes, inPreparation, baseMinutes, travelMinutes, manualExtraMinutes, fulfillment } = input;
  // Smoothing: the more samples, the more the median weighs against the base time (no hard switch).
  const k = Math.min(samplesMinutes.length, SAMPLE_WINDOW);
  let kitchen = k === 0 ? baseMinutes : (k * median(samplesMinutes) + BLEND_WEIGHT_BASE * baseMinutes) / (k + BLEND_WEIGHT_BASE);
  kitchen += Math.min(MAX_QUEUE_SURCHARGE, Math.ceil(Math.max(0, inPreparation - FREE_QUEUE) * MIN_PER_EXTRA_ORDER));
  kitchen = Math.min(kitchen, MAX_KITCHEN_MINUTES);
  const raw = kitchen + manualExtraMinutes + (fulfillment === "delivery" ? travelMinutes : 0);
  const center = Math.round(raw / ROUND_TO) * ROUND_TO;
  return {
    low: Math.max(5, center - RANGE_HALF_WIDTH),
    high: center + RANGE_HALF_WIDTH,
    delayed: manualExtraMinutes > 0 || kitchen - baseMinutes > DELAYED_THRESHOLD,
  };
}
