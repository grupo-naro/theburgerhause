import { describe, expect, it } from "vitest";
import { businessDateFor } from "@/db/order-number";

describe("businessDateFor", () => {
  it("uses the Argentina (UTC-3) calendar day: 02:30Z is still the previous day", () => {
    expect(businessDateFor(new Date("2026-10-14T02:30:00Z"))).toBe("2026-10-13");
  });
  it("rolls over at 03:00Z (midnight in Buenos Aires)", () => {
    expect(businessDateFor(new Date("2026-10-14T03:00:00Z"))).toBe("2026-10-14");
  });
  it("handles year boundaries", () => {
    expect(businessDateFor(new Date("2027-01-01T02:59:59Z"))).toBe("2026-12-31");
  });
});
