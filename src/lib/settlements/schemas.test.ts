import { describe, expect, it } from "vitest";
import { settleCadetInputSchema } from "./schemas";

const base = { cadetId: 1, expectedAmount: 1500_00, userId: 2 };
const parse = (over: Record<string, unknown>) => settleCadetInputSchema.safeParse({ ...base, ...over });

describe("settleCadetInputSchema", () => {
  it("accepts a minimal valid input and a note", () => {
    expect(parse({})).toMatchObject({ success: true, data: { cadetId: 1, expectedAmount: 150000, userId: 2 } });
    expect(parse({ note: "Faltaron $500" })).toMatchObject({ success: true, data: { note: "Faltaron $500" } });
  });

  it.each([0, -1, 1.5, Number.NaN, Infinity, 2_147_483_648, "100", null, undefined])("rejects expectedAmount %j", (v) => {
    expect(parse({ expectedAmount: v }).success).toBe(false);
  });
  it("accepts the int4 bounds 1 and 2147483647", () => {
    expect(parse({ expectedAmount: 1 }).success).toBe(true);
    expect(parse({ expectedAmount: 2_147_483_647 }).success).toBe(true);
  });

  it.each([0, -3, 1.2, 2_147_483_648, "1", null, undefined])("rejects ids %j", (v) => {
    expect(parse({ cadetId: v }).success).toBe(false);
    expect(parse({ userId: v }).success).toBe(false);
  });

  it("cleans the note: trims, collapses control and bidi characters; empty becomes undefined", () => {
    expect(parse({ note: "  hola\u0000 mundo‮  " })).toMatchObject({ data: { note: "hola mundo" } });
    expect(parse({ note: "a\nb" })).toMatchObject({ data: { note: "a b" } });
    expect(parse({ note: "   " })).toMatchObject({ success: true, data: { note: undefined } });
    expect(parse({ note: undefined })).toMatchObject({ success: true, data: { note: undefined } });
  });
  it("the note is capped at 200 characters after cleaning and must be a string", () => {
    expect(parse({ note: "a".repeat(200) }).success).toBe(true);
    expect(parse({ note: "a".repeat(201) }).success).toBe(false);
    expect(parse({ note: ` ${"a".repeat(200)} ` }).success).toBe(true);
    expect(parse({ note: 5 }).success).toBe(false);
  });

  it("strips unknown keys", () => {
    const r = parse({ amount: 1, status: "x" });
    expect(r.success && Object.keys(r.data).sort()).toEqual(["cadetId", "expectedAmount", "userId"]);
  });
});
