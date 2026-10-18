import { describe, expect, it } from "vitest";
import { formatPesosInput, parsePesosToCents } from "./parse-pesos";

const ok = (cents: number) => ({ ok: true, cents });
const bad = (reason: string) => ({ ok: false, reason });

describe("parsePesosToCents", () => {
  it.each([
    ["12345", 1_234_500],
    ["12.345", 1_234_500],
    ["1.000", 100_000],
    ["1.234.567", 123_456_700],
    ["0", 0],
    ["00", 0],
    ["  500  ", 50_000],
    ["$ 2.500", 250_000],
    ["12.345,50", 1_234_550],
    ["1.000,5", 100_050],
    ["1000,05", 100_005],
    ["0,5", 50],
    [",5", 50],
    ["12345,00", 1_234_500],
    ["12345,", 1_234_500],
  ])("accepts %j", (input, cents) => {
    expect(parsePesosToCents(input)).toEqual(ok(cents));
  });

  it.each([
    ["", "empty"],
    [" ", "empty"],
    ["abc", "invalid"],
    ["12a", "invalid"],
    ["1.5", "invalid"], // a dot is only a thousands separator
    ["1.00", "invalid"],
    ["0.123", "invalid"], // a leading zero group is not a thousands group
    ["0.000", "invalid"],
    ["00.500", "invalid"],
    ["12.34.567", "invalid"],
    [".500", "invalid"],
    ["1,234,5", "invalid"],
    ["1,234", "invalid"], // at most two decimals
    ["1e5", "invalid"],
    ["NaN", "invalid"],
    ["Infinity", "invalid"],
    ["-5", "negative"],
    ["-0", "negative"],
    ["-1.000,50", "negative"],
    ["99999999999", "too_big"],
    ["21.474.837", "too_big"], // 21,474,837 pesos > int4 centavos
  ])("rejects %j as %s", (input, reason) => {
    expect(parsePesosToCents(input)).toEqual(bad(reason));
  });

  it("accepts the largest int4 amount and refuses one centavo more", () => {
    expect(parsePesosToCents("21.474.836,47")).toEqual(ok(2_147_483_647));
    expect(parsePesosToCents("21.474.836,48")).toEqual(bad("too_big"));
  });

  it("returns integer centavos for small decimals", () => {
    expect(parsePesosToCents("0,07")).toEqual(ok(7));
  });
});

describe("formatPesosInput", () => {
  it("shows whole pesos with thousands dots and cents only when present", () => {
    expect(formatPesosInput(1_234_500)).toBe("12.345");
    expect(formatPesosInput(0)).toBe("0");
    expect(formatPesosInput(100_050)).toBe("1.000,50");
    expect(formatPesosInput(7)).toBe("0,07");
    expect(formatPesosInput(50)).toBe("0,50");
  });
  it("round-trips through the parser", () => {
    for (const c of [0, 7, 50, 100, 999_999, 1_234_550, 2_147_483_647]) {
      expect(parsePesosToCents(formatPesosInput(c))).toEqual(ok(c));
    }
  });
});
