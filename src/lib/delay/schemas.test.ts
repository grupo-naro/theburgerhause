import { describe, expect, it } from "vitest";
import { activateDelaySchema } from "./schemas";

const parse = (extraMinutes: number, reason: string) => activateDelaySchema.safeParse({ extraMinutes, reason });

describe("activateDelaySchema", () => {
  it("rejects minutes that are not multiples of 5", () => expect(parse(7, "x").success).toBe(false));
  it("rejects minutes above 60", () => expect(parse(65, "x").success).toBe(false));
  it("rejects minutes below 5", () => expect(parse(0, "x").success).toBe(false));
  it("trims the reason", () => {
    const r = parse(10, "  Se pinchó  ");
    expect(r.success && r.data).toEqual({ extraMinutes: 10, reason: "Se pinchó" });
  });
  it("rejects an empty or blank reason", () => {
    expect(parse(10, "").success).toBe(false);
    expect(parse(10, "   ").success).toBe(false);
  });
  it("rejects a reason over 120 chars and accepts exactly 120", () => {
    expect(parse(10, "a".repeat(121)).success).toBe(false);
    expect(parse(10, "a".repeat(120)).success).toBe(true);
  });
});
