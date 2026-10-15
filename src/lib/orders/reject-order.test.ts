import { describe, expect, it } from "vitest";
import { rejectReasonSchema } from "./reject-order";

describe("rejectReasonSchema", () => {
  it("trims and accepts 3..200 chars", () => {
    expect(rejectReasonSchema.parse("  Sin stock  ")).toBe("Sin stock");
    expect(rejectReasonSchema.safeParse("abc").success).toBe(true);
    expect(rejectReasonSchema.safeParse("a".repeat(200)).success).toBe(true);
  });
  it.each(["", "   ", "ab", " a  ", "a".repeat(201), 5, null, undefined])("rejects %j", (v) => {
    expect(rejectReasonSchema.safeParse(v).success).toBe(false);
  });
  it("strips control and bidi characters before measuring", () => {
    expect(rejectReasonSchema.parse("Sin\u0000 st‮ock\u0007")).toBe("Sin stock");
    expect(rejectReasonSchema.safeParse("\u0000\u0001ab‮").success).toBe(false);
  });
  it("turns newlines and tabs into single spaces", () => {
    expect(rejectReasonSchema.parse("Sin\n\nstock\tahora")).toBe("Sin stock ahora");
  });
});
