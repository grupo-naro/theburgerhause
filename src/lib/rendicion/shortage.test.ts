import { describe, expect, it } from "vitest";
import { diffLabel, formatMoney, shortageFor } from "./shortage";

const norm = (s: string) => s.replace(/\s/g, " ");

describe("shortageFor", () => {
  it.each([
    [1_000_00, 1_000_00, { kind: "exact", diff: 0 }],
    [1_000_00, 99_999, { kind: "short", diff: 1 }], // one centavo short
    [1_000_00, 0, { kind: "short", diff: 1_000_00 }],
    [1_000_00, 1_000_01, { kind: "over", diff: 1 }],
    [1_000_00, 5_000_00, { kind: "over", diff: 4_000_00 }],
  ])("expected %i received %i", (expected, received, out) => {
    expect(shortageFor(expected, received)).toEqual(out);
  });
  it("refuses unsafe numbers", () => {
    expect(() => shortageFor(Number.MAX_SAFE_INTEGER + 1, 0)).toThrow();
    expect(() => shortageFor(10, 1.5)).toThrow();
  });
});

describe("formatMoney", () => {
  it("whole pesos without decimals, cents when present", () => {
    expect(norm(formatMoney(1_234_500))).toBe("$ 12.345");
    expect(norm(formatMoney(1_234_550))).toBe("$ 12.345,50");
    expect(norm(formatMoney(1))).toBe("$ 0,01");
  });
});

describe("diffLabel", () => {
  it("exact", () => {
    expect(diffLabel(500_00, 500_00)).toEqual({ kind: "exact", text: "Exacto", tone: "ok" });
  });
  it("short: Faltan $X", () => {
    const l = diffLabel(500_00, 300_00);
    expect(l.kind).toBe("short");
    expect(l.tone).toBe("danger");
    expect(norm(l.text)).toBe("Faltan $ 200");
  });
  it("over: the inline error", () => {
    expect(diffLabel(500_00, 600_00)).toEqual({ kind: "over", text: "No puede ser más que lo que debe rendir", tone: "danger" });
  });
});
