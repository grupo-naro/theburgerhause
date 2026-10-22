import { describe, expect, it } from "vitest";
import { MAX_TANDA_ORDERS, parseTanda, tandaSummary } from "./tanda";

describe("parseTanda", () => {
  it("accepts integers 1..99 (string or number), trimming spaces", () => {
    expect(parseTanda("2")).toEqual({ ok: true, tanda: 2 });
    expect(parseTanda("  3 ")).toEqual({ ok: true, tanda: 3 });
    expect(parseTanda("99")).toEqual({ ok: true, tanda: 99 });
    expect(parseTanda("1")).toEqual({ ok: true, tanda: 1 });
    expect(parseTanda(5)).toEqual({ ok: true, tanda: 5 });
  });

  it("empty, blank and null clear the tanda", () => {
    expect(parseTanda("")).toEqual({ ok: true, tanda: null });
    expect(parseTanda("   ")).toEqual({ ok: true, tanda: null });
    expect(parseTanda(null)).toEqual({ ok: true, tanda: null });
  });

  it.each(["0", "100", "-1", "abc", "1.5", "1e1", "0x10", "2 3"])("rejects %j with a clear message", (v) => {
    const r = parseTanda(v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("La tanda debe ser un número entero del 1 al 99.");
  });

  it("rejects non-integer and out-of-range numbers", () => {
    for (const n of [0, 100, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(parseTanda(n).ok).toBe(false);
  });
});

describe("tandaSummary", () => {
  it("counts only en_preparacion and listo_despacho, ignores en_camino and orders without tanda, sorted by number", () => {
    const s = tandaSummary([
      { id: 1, tanda: 2, status: "en_preparacion" },
      { id: 2, tanda: 1, status: "listo_despacho" },
      { id: 3, tanda: 1, status: "en_camino" },
      { id: 4, tanda: null, status: "en_preparacion" },
      { id: 5, tanda: 2, status: "listo_despacho" },
      { id: 6, tanda: 7, status: "en_camino" },
    ]);
    expect(s).toEqual([
      { tanda: 1, count: 1, overLimit: false },
      { tanda: 2, count: 2, overLimit: false },
    ]);
  });

  it("flags overLimit above MAX_TANDA_ORDERS (3), not at 3", () => {
    expect(MAX_TANDA_ORDERS).toBe(3);
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, tanda: 4, status: "en_preparacion" as const }));
    expect(tandaSummary(mk(3))).toEqual([{ tanda: 4, count: 3, overLimit: false }]);
    expect(tandaSummary(mk(4))).toEqual([{ tanda: 4, count: 4, overLimit: true }]);
  });

  it("is empty with no tandas", () => {
    expect(tandaSummary([])).toEqual([]);
  });
});
