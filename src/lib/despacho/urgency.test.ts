import { describe, expect, it } from "vitest";
import { orderUrgency } from "./urgency";

const created = "2026-10-15T15:00:00.000Z";
const at = (min: number) => Date.parse(created) + min * 60_000;

describe("orderUrgency", () => {
  it("reuses the Caja thresholds for preparing, ready and pickup orders", () => {
    for (const lane of ["preparing", "ready", "pickup"] as const) {
      expect(orderUrgency(lane, created, at(4))).toBe("normal");
      expect(orderUrgency(lane, created, at(5))).toBe("warning");
      expect(orderUrgency(lane, created, at(10))).toBe("warning");
      expect(orderUrgency(lane, created, at(11))).toBe("urgent");
    }
  });
  it("en route orders never escalate by age (the delivery takes the time it takes)", () => {
    expect(orderUrgency("enRoute", created, at(120))).toBe("normal");
  });
});
