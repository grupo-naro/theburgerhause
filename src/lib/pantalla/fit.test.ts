import { describe, expect, it } from "vitest";
import { capBelowReady, CELL_H_EM, cellWidthEm, fitNumbers, PREPARING_RATIO } from "./fit";

const zone = { width: 1200, height: 800, maxFont: 200, minFont: 48 };

describe("capBelowReady (the ready numbers are always the bigger ones)", () => {
  it("caps the preparation sizes at ~70% of the ready font", () => {
    expect(capBelowReady({ maxFont: 119, minFont: 43 }, 88)).toEqual({ maxFont: 61, minFont: 43 });
    expect(PREPARING_RATIO).toBe(0.7);
  });
  it("leaves them alone when the ready numbers are huge (few or none ready)", () => {
    expect(capBelowReady({ maxFont: 119, minFont: 43 }, 238)).toEqual({ maxFont: 119, minFont: 43 });
  });
  it("never lets the minimum pass the cap (the zone auto-scrolls instead)", () => {
    expect(capBelowReady({ maxFont: 119, minFont: 43 }, 50)).toEqual({ maxFont: 35, minFont: 35 });
  });
  it("without a measured ready font it changes nothing", () => {
    expect(capBelowReady({ maxFont: 119, minFont: 43 }, null)).toEqual({ maxFont: 119, minFont: 43 });
  });
});

describe("fitNumbers", () => {
  it("few numbers (or none) use the biggest size, no scrolling", () => {
    expect(fitNumbers({ ...zone, count: 0, digits: 2 })).toMatchObject({ font: 200, scroll: false });
    expect(fitNumbers({ ...zone, count: 2, digits: 2 })).toMatchObject({ font: 200, scroll: false });
  });

  it("more numbers shrink the size (never grow it) and the grid always fits while not scrolling", () => {
    let prev = Infinity;
    for (let count = 1; count <= 60; count++) {
      const f = fitNumbers({ ...zone, count, digits: 3 });
      expect(f.font).toBeLessThanOrEqual(prev);
      prev = f.font;
      if (!f.scroll) {
        expect(f.columns * f.font * cellWidthEm(3)).toBeLessThanOrEqual(zone.width);
        expect(Math.ceil(count / f.columns) * f.font * CELL_H_EM).toBeLessThanOrEqual(zone.height);
      }
    }
  });

  it("40 numbers in a TV zone still fit without scrolling and stay readable", () => {
    const tvReady = fitNumbers({ width: 1240, height: 860, maxFont: 220, minFont: 56, count: 40, digits: 3 });
    expect(tvReady.scroll).toBe(false);
    expect(tvReady.font).toBeGreaterThanOrEqual(56);
  });

  it("when even the smallest size does not fit, it keeps the smallest size and asks for the gentle auto-scroll", () => {
    const f = fitNumbers({ ...zone, height: 200, count: 300, digits: 3 });
    expect(f).toMatchObject({ font: 48, scroll: true });
    expect(f.columns).toBeGreaterThanOrEqual(1);
  });

  it("a zone not measured yet (0 x 0) does not crash", () => {
    expect(fitNumbers({ ...zone, width: 0, height: 0, count: 5, digits: 2 })).toMatchObject({ columns: 1 });
  });
});
