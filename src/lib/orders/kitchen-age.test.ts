import { describe, expect, it } from "vitest";
import { ageColor, ageLabel, kitchenThresholds, DEFAULT_KDS_THRESHOLDS } from "./kitchen-age";

const t = { warnMin: 8, lateMin: 15 };

describe("ageColor", () => {
  it("is green below the warning threshold", () => {
    expect(ageColor(0, t)).toBe("green");
    expect(ageColor(7, t)).toBe("green");
  });
  it("is yellow from the warning threshold up to (not including) the late one", () => {
    expect(ageColor(8, t)).toBe("yellow");
    expect(ageColor(14, t)).toBe("yellow");
  });
  it("is red from the late threshold on", () => {
    expect(ageColor(15, t)).toBe("red");
    expect(ageColor(90, t)).toBe("red");
  });
  it("honours custom thresholds", () => {
    expect(ageColor(4, { warnMin: 5, lateMin: 10 })).toBe("green");
    expect(ageColor(5, { warnMin: 5, lateMin: 10 })).toBe("yellow");
    expect(ageColor(10, { warnMin: 5, lateMin: 10 })).toBe("red");
  });
});

describe("kitchenThresholds", () => {
  it("reads the settings fields", () => {
    expect(kitchenThresholds({ kdsWarnMinutes: 5, kdsLateMinutes: 12 })).toEqual({ warnMin: 5, lateMin: 12 });
  });
  it("falls back to the defaults (8 / 15) on garbage or an inverted pair", () => {
    expect(DEFAULT_KDS_THRESHOLDS).toEqual(t);
    expect(kitchenThresholds({ kdsWarnMinutes: 0, kdsLateMinutes: 12 })).toEqual(t);
    expect(kitchenThresholds({ kdsWarnMinutes: 20, kdsLateMinutes: 10 })).toEqual(t);
    expect(kitchenThresholds({ kdsWarnMinutes: Number.NaN, kdsLateMinutes: 10 })).toEqual(t);
  });
});

describe("ageLabel", () => {
  it("is Spanish and never negative", () => {
    expect(ageLabel(0)).toBe("recién entró");
    expect(ageLabel(1)).toBe("hace 1 min");
    expect(ageLabel(7)).toBe("hace 7 min");
    expect(ageLabel(75)).toBe("hace 1 h 15 min");
    expect(ageLabel(120)).toBe("hace 2 h");
    expect(ageLabel(-4)).toBe("recién entró");
  });
});
