import { describe, expect, it } from "vitest";
import { ageMinutes, canActOn, KITCHEN_TYPE_COLOR, KITCHEN_TYPE_LABEL, sectorOfKitchenType } from "./card-style";

describe("kitchen type tags", () => {
  it("labels and colours: DELIVERY orange, MOSTRADOR blue, RETIRO distinct from both", () => {
    expect(KITCHEN_TYPE_LABEL).toEqual({ delivery: "DELIVERY", mostrador: "MOSTRADOR", retiro: "RETIRO" });
    expect(KITCHEN_TYPE_COLOR.delivery).toBe("#e0612b");
    expect(KITCHEN_TYPE_COLOR.mostrador).toBe("#3b6fd1");
    expect(new Set(Object.values(KITCHEN_TYPE_COLOR)).size).toBe(3);
  });
});

describe("sectorOfKitchenType / canActOn", () => {
  it("delivery cards belong to the delivery sector; counter and takeaway to the counter", () => {
    expect(sectorOfKitchenType("delivery")).toBe("delivery");
    expect(sectorOfKitchenType("mostrador")).toBe("mostrador");
    expect(sectorOfKitchenType("retiro")).toBe("mostrador");
  });
  it("an exempt actor (cocina / admin: null) acts on everything; staff only on their sector", () => {
    for (const t of ["delivery", "mostrador", "retiro"] as const) expect(canActOn(null, t)).toBe(true);
    expect(canActOn("mostrador", "delivery")).toBe(false);
    expect(canActOn("mostrador", "retiro")).toBe(true);
    expect(canActOn("delivery", "delivery")).toBe(true);
    expect(canActOn("delivery", "mostrador")).toBe(false);
  });
});

describe("ageMinutes", () => {
  const now = Date.parse("2026-10-18T15:10:00Z");
  it("whole minutes, floored, never negative", () => {
    expect(ageMinutes("2026-10-18T15:03:01Z", now)).toBe(6);
    expect(ageMinutes("2026-10-18T15:03:00Z", now)).toBe(7);
    expect(ageMinutes("2026-10-18T15:30:00Z", now)).toBe(0);
    expect(ageMinutes("garbage", now)).toBe(0);
  });
});
