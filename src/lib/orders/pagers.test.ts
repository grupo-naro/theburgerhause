import { describe, expect, it } from "vitest";
import { nextFreePager } from "./pagers";

describe("nextFreePager", () => {
  it("returns 1 when nothing is used", () => expect(nextFreePager([])).toBe(1));
  it("returns the lowest free number", () => expect(nextFreePager([1, 2, 4])).toBe(3));
  it("honours `from`", () => {
    expect(nextFreePager([5, 6], 5)).toBe(7);
    expect(nextFreePager([], 10)).toBe(10);
  });
  it("wraps around after 999", () => {
    expect(nextFreePager([998, 999], 998)).toBe(1);
    expect(nextFreePager([999, 1, 2], 999)).toBe(3);
  });
  it("returns null when all 999 are used", () => {
    expect(nextFreePager(Array.from({ length: 999 }, (_, i) => i + 1))).toBeNull();
  });
  it("ignores duplicates and out-of-range values; clamps a bad `from`", () => {
    expect(nextFreePager([1, 1, 0, 1000, -5, 2.5])).toBe(2);
    expect(nextFreePager([], 0)).toBe(1);
    expect(nextFreePager([], 5000)).toBe(1);
  });
});
