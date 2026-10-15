import { describe, expect, it } from "vitest";
import { elapsedMs, formatElapsed, urgencyOf } from "./elapsed";

const MIN = 60_000;
const SEC = 1000;
const created = "2026-10-15T12:00:00.000Z";
const at = (ms: number) => new Date(Date.parse(created) + ms);

describe("elapsedMs", () => {
  it("is now minus createdAt, never negative (clock skew)", () => {
    expect(elapsedMs(created, at(90 * SEC))).toBe(90 * SEC);
    expect(elapsedMs(created, at(-5 * SEC))).toBe(0);
  });
  it("an unparsable date counts as zero", () => {
    expect(elapsedMs("nope", at(0))).toBe(0);
  });
});

describe("urgencyOf (thresholds table)", () => {
  const table: [string, number, "normal" | "warning" | "urgent"][] = [
    ["0:00", 0, "normal"],
    ["4:59", 4 * MIN + 59 * SEC, "normal"],
    ["5:00", 5 * MIN, "warning"],
    ["7:30", 7 * MIN + 30 * SEC, "warning"],
    ["10:00", 10 * MIN, "warning"],
    ["10:01", 10 * MIN + SEC, "urgent"],
    ["45:00", 45 * MIN, "urgent"],
  ];
  for (const [label, ms, expected] of table) {
    it(`${label} -> ${expected}`, () => expect(urgencyOf(ms)).toBe(expected));
  }
});

describe("formatElapsed", () => {
  const table: [number, string][] = [
    [0, "recién"],
    [59 * SEC, "recién"],
    [60 * SEC, "hace 1 min"],
    [4 * MIN + 59 * SEC, "hace 4 min"],
    [5 * MIN, "hace 5 min"],
    [59 * MIN, "hace 59 min"],
    [60 * MIN, "hace 1 h"],
    [65 * MIN, "hace 1 h 5 min"],
    [3 * 60 * MIN, "hace 3 h"],
  ];
  for (const [ms, expected] of table) {
    it(`${ms} ms -> ${expected}`, () => expect(formatElapsed(ms)).toBe(expected));
  }
});
