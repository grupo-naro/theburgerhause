import { describe, expect, it } from "vitest";
import { buildDespachoTitle } from "./title";

describe("buildDespachoTitle", () => {
  it("shows the count of delivery orders to assign", () => expect(buildDespachoTitle(3)).toBe("(3) Despacho"));
  it("hides zero, negatives and garbage", () => {
    expect(buildDespachoTitle(0)).toBe("Despacho");
    expect(buildDespachoTitle(-2)).toBe("Despacho");
    expect(buildDespachoTitle(Number.NaN)).toBe("Despacho");
  });
  it("floors fractions", () => expect(buildDespachoTitle(2.9)).toBe("(2) Despacho"));
});
