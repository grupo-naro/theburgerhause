import { describe, expect, it } from "vitest";
import { businessDateFor } from "@/db/order-number";

describe("businessDateFor", () => {
  it("uses the Argentina (UTC-3) calendar day: 02:30Z is still the previous day", () => {
    expect(businessDateFor(new Date("2026-10-14T02:30:00Z"), "00:00")).toBe("2026-10-13");
  });
  it("rolls over at 03:00Z (midnight in Buenos Aires)", () => {
    expect(businessDateFor(new Date("2026-10-14T03:00:00Z"), "00:00")).toBe("2026-10-14");
  });
  it("handles year boundaries", () => {
    expect(businessDateFor(new Date("2027-01-01T02:59:59Z"), "00:00")).toBe("2026-12-31");
  });
});

describe("businessDateFor with a business-day cutoff (default 06:00 Buenos Aires)", () => {
  // 23:50 BA = 02:50Z next day; 00:05 BA = 03:05Z
  it("23:50 and 00:05 belong to the same business day", () => {
    const late = businessDateFor(new Date("2026-10-15T02:50:00Z")); // 14/10 23:50 BA
    const after = businessDateFor(new Date("2026-10-15T03:05:00Z")); // 15/10 00:05 BA
    expect(late).toBe("2026-10-14");
    expect(after).toBe("2026-10-14");
  });
  it("rolls over exactly at the cutoff: 05:59 BA is still yesterday, 06:00 BA is today", () => {
    expect(businessDateFor(new Date("2026-10-15T08:59:59Z"))).toBe("2026-10-14");
    expect(businessDateFor(new Date("2026-10-15T09:00:00Z"))).toBe("2026-10-15");
  });
  it("honours a custom cutoff", () => {
    expect(businessDateFor(new Date("2026-10-15T06:59:00Z"), "04:00")).toBe("2026-10-14"); // 03:59 BA
    expect(businessDateFor(new Date("2026-10-15T07:00:00Z"), "04:00")).toBe("2026-10-15"); // 04:00 BA
  });
  it("cutoff 00:00 keeps the calendar day", () => {
    expect(businessDateFor(new Date("2026-10-15T03:05:00Z"), "00:00")).toBe("2026-10-15");
  });
  it("ignores a malformed cutoff (falls back to the default)", () => {
    expect(businessDateFor(new Date("2026-10-15T03:05:00Z"), "garbage")).toBe("2026-10-14");
  });
});
