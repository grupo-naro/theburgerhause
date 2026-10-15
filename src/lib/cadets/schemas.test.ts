import { describe, expect, it } from "vitest";
import { cadetInputSchema } from "./schemas";

const base = { name: "Juan", phone: "", active: true };

describe("cadetInputSchema", () => {
  it("accepts a minimal cadet and turns a blank phone into null", () => {
    expect(cadetInputSchema.parse(base)).toEqual({ name: "Juan", phone: null, active: true });
    expect(cadetInputSchema.parse({ ...base, phone: "   " }).phone).toBeNull();
    expect(cadetInputSchema.parse({ name: "Juan", active: false }).phone).toBeNull();
  });
  it("trims the name and requires 1..80 characters", () => {
    expect(cadetInputSchema.parse({ ...base, name: "  Ana  " }).name).toBe("Ana");
    expect(cadetInputSchema.safeParse({ ...base, name: "   " }).success).toBe(false);
    expect(cadetInputSchema.safeParse({ ...base, name: "x".repeat(81) }).success).toBe(false);
    expect(cadetInputSchema.safeParse({ ...base, name: "x".repeat(80) }).success).toBe(true);
  });
  it("normalizes phone whitespace and accepts digits, spaces, + - ( )", () => {
    expect(cadetInputSchema.parse({ ...base, phone: " +54  (11) 5555-1234 " }).phone).toBe("+54 (11) 5555-1234");
  });
  it("rejects letters and other characters in the phone, and phones over 30 chars", () => {
    for (const phone of ["11-ABCD", "11.5555", "11/5555", "5555#1"]) {
      expect(cadetInputSchema.safeParse({ ...base, phone }).success).toBe(false);
    }
    expect(cadetInputSchema.safeParse({ ...base, phone: "1".repeat(31) }).success).toBe(false);
    expect(cadetInputSchema.safeParse({ ...base, phone: "1".repeat(30) }).success).toBe(true);
  });
  it("validates the optional id", () => {
    expect(cadetInputSchema.parse({ ...base, id: 3 }).id).toBe(3);
    expect(cadetInputSchema.safeParse({ ...base, id: 0 }).success).toBe(false);
    expect(cadetInputSchema.safeParse({ ...base, id: 1.5 }).success).toBe(false);
  });
});
