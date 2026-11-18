import { describe, expect, it } from "vitest";
import { pattiesBreakdownText, pattiesTotalText } from "./patties-copy";

describe("patties copy", () => {
  it("total, singular and plural with thousands separator", () => {
    expect(pattiesTotalText(1)).toBe("1 medallón");
    expect(pattiesTotalText(0)).toBe("0 medallones");
    expect(pattiesTotalText(1284)).toBe("1.284 medallones");
  });
  it("breakdown omits empty levels; all empty says so", () => {
    expect(pattiesBreakdownText({ 1: 412, 2: 301, 3: 90 })).toBe("Simple: 412 u · Doble: 301 u · Triple: 90 u");
    expect(pattiesBreakdownText({ 1: 5, 2: 0, 3: 1 })).toBe("Simple: 5 u · Triple: 1 u");
    expect(pattiesBreakdownText({ 1: 0, 2: 0, 3: 0 })).toBe("Sin hamburguesas en este período");
  });
});
