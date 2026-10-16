import { describe, expect, it } from "vitest";
import { changeFor, MAX_RECEIVED_CENTS, parsePesosInput, quickAmounts } from "./change";

describe("changeFor", () => {
  it("exact payment -> exact, no change", () => {
    expect(changeFor(1_700_000, 1_700_000)).toEqual({ kind: "exact", cents: 0 });
  });
  it("over -> change in cents", () => {
    expect(changeFor(1_700_000, 2_000_000)).toEqual({ kind: "change", cents: 300_000 });
  });
  it("short -> missing amount (never negative)", () => {
    expect(changeFor(1_700_000, 1_000_000)).toEqual({ kind: "short", cents: 700_000 });
  });
  it("nothing received -> none", () => {
    expect(changeFor(1_700_000, 0)).toEqual({ kind: "none", cents: 0 });
    expect(changeFor(1_700_000, null)).toEqual({ kind: "none", cents: 0 });
  });
  it("zero total with something received is all change", () => {
    expect(changeFor(0, 500)).toEqual({ kind: "change", cents: 500 });
  });
  it("works in plain cents, one cent at a time", () => {
    expect(changeFor(1_001, 1_002)).toEqual({ kind: "change", cents: 1 });
    expect(changeFor(1_001, 1_000)).toEqual({ kind: "short", cents: 1 });
  });
  it("huge amounts stay exact integers", () => {
    expect(changeFor(1_000_000_000, MAX_RECEIVED_CENTS)).toEqual({ kind: "change", cents: MAX_RECEIVED_CENTS - 1_000_000_000 });
  });
  it("garbage input is treated as nothing received", () => {
    expect(changeFor(1000, Number.NaN)).toEqual({ kind: "none", cents: 0 });
    expect(changeFor(1000, -5)).toEqual({ kind: "none", cents: 0 });
    expect(changeFor(1000, 10.5)).toEqual({ kind: "none", cents: 0 });
  });
});

describe("quickAmounts", () => {
  it("starts with the exact total", () => {
    expect(quickAmounts(2_550_000)[0]).toBe(2_550_000);
  });
  it("rounds up to the next bill and dedupes", () => {
    // 25.500 -> exact, 26.000 (1k and 2k), 30.000 (5k and 10k), 40.000 (20k)
    expect(quickAmounts(2_550_000)).toEqual([2_550_000, 2_600_000, 3_000_000, 4_000_000]);
  });
  it("a total that is already a multiple of every bill yields only itself", () => {
    expect(quickAmounts(4_000_000)).toEqual([4_000_000]);
  });
  it("never offers an amount below the total", () => {
    for (const total of [1, 99_999, 100_000, 100_001, 850_000, 2_345_600, 9_999_999]) {
      for (const a of quickAmounts(total)) expect(a).toBeGreaterThanOrEqual(total);
    }
  });
  it("a small total offers the bills above it", () => {
    expect(quickAmounts(850_000)).toEqual([850_000, 900_000, 1_000_000, 2_000_000]);
  });
  it("is ascending and at most 6 values", () => {
    const a = quickAmounts(123_456);
    expect([...a].sort((x, y) => x - y)).toEqual(a);
    expect(a.length).toBeLessThanOrEqual(6);
  });
  it("zero or invalid total -> no suggestions", () => {
    expect(quickAmounts(0)).toEqual([]);
    expect(quickAmounts(-1)).toEqual([]);
    expect(quickAmounts(Number.NaN)).toEqual([]);
  });
});

describe("parsePesosInput", () => {
  it("digits are whole pesos, returned in cents", () => {
    expect(parsePesosInput("30000")).toBe(3_000_000);
  });
  it("ignores thousands separators and spaces", () => {
    expect(parsePesosInput("30.000")).toBe(3_000_000);
    expect(parsePesosInput(" 1 500 ")).toBe(150_000);
  });
  it("blank or no digits -> null", () => {
    expect(parsePesosInput("")).toBeNull();
    expect(parsePesosInput("abc")).toBeNull();
  });
  it("caps absurd amounts", () => {
    expect(parsePesosInput("9".repeat(15))).toBe(MAX_RECEIVED_CENTS);
  });
});
