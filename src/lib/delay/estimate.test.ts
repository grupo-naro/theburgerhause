import { describe, expect, it } from "vitest";
import { computeEstimate, type EstimateInput } from "./estimate";

const base: EstimateInput = {
  samplesMinutes: [],
  inPreparation: 0,
  baseMinutes: 25,
  travelMinutes: 15,
  manualExtraMinutes: 0,
  fulfillment: "takeaway",
};
const est = (o: Partial<EstimateInput> = {}) => computeEstimate({ ...base, ...o });

describe("computeEstimate", () => {
  it("uses the base time without samples", () => {
    expect(est()).toEqual({ low: 20, high: 30, delayed: false });
  });
  it("adds travel for delivery", () => {
    expect(est({ fulfillment: "delivery" })).toEqual({ low: 35, high: 45, delayed: false });
  });
  it("uses the median of 5+ samples and flags delay", () => {
    expect(est({ samplesMinutes: [40, 40, 40, 40, 40] })).toEqual({ low: 35, high: 45, delayed: true });
  });
  it("ignores fewer than 5 samples", () => {
    expect(est({ samplesMinutes: [60, 60, 60, 60] })).toEqual({ low: 20, high: 30, delayed: false });
  });
  it("manual extra marks delayed", () => {
    expect(est({ manualExtraMinutes: 10 })).toEqual({ low: 30, high: 40, delayed: true });
  });
  it("caps the queue surcharge at 60", () => {
    expect(est({ inPreparation: 55 })).toEqual({ low: 80, high: 90, delayed: true });
  });
  it("caps kitchen time at 90", () => {
    expect(est({ inPreparation: 200, samplesMinutes: [80, 80, 80, 80, 80] })).toEqual({ low: 85, high: 95, delayed: true });
  });
  it("adds no surcharge for a short queue", () => {
    expect(est({ inPreparation: 3 })).toEqual({ low: 20, high: 30, delayed: false });
  });
  it("never lets low go below 5", () => {
    expect(est({ baseMinutes: 0 }).low).toBe(5);
  });
});
