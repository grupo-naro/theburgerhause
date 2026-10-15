import { describe, expect, it } from "vitest";
import { CART_STORAGE_KEY, clearCartStorage, loadCart, parseCart, saveCart, serializeCart } from "./persistence";
import type { CartLine } from "./types";

const line = (id: string, over: Partial<CartLine> = {}): CartLine => ({ id, productId: 1, modifierIds: [1, 2], note: "x", ...over });
const state = (lines: CartLine[]) => ({ lines });
const wrap = (lines: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ v: 1, lines, prices: {}, ...extra });
const rawLine = (over: Record<string, unknown>) => ({ id: "a", productId: 1, modifierIds: [], note: "", ...over });

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
    removeItem: (k: string) => void delete data[k],
  };
}

describe("serialize / parse", () => {
  it("key is versioned", () => expect(CART_STORAGE_KEY).toBe("bh_cart_v1"));
  it("round trips lines and prices", () => {
    const lines = [line("a"), line("b", { productId: 2, modifierIds: [] })];
    expect(parseCart(serializeCart(state(lines), { a: 100, b: 200 }))).toEqual({ lines, prices: { a: 100, b: 200 } });
  });
  it("serialization drops prices of lines that no longer exist", () => {
    expect(parseCart(serializeCart(state([line("a")]), { a: 1, zzz: 2 }))?.prices).toEqual({ a: 1 });
  });
  it("normalizes modifier ids and notes on the way in", () => {
    const raw = wrap([rawLine({ modifierIds: [3, 1, 3], note: "  hi " })]);
    expect(parseCart(raw)?.lines[0]).toEqual({ id: "a", productId: 1, modifierIds: [1, 3], note: "hi" });
  });
  it("strips unknown fields", () => {
    const raw = wrap([rawLine({ price: 1, extra: { x: 1 } })], { evil: 1 });
    const p = parseCart(raw);
    expect(p?.lines[0]).toEqual({ id: "a", productId: 1, modifierIds: [], note: "" });
    expect(p).not.toHaveProperty("evil");
  });
  it("missing prices are tolerated", () => {
    expect(parseCart(JSON.stringify({ v: 1, lines: [] }))).toEqual({ lines: [], prices: {} });
  });
  it.each([
    ["null", null],
    ["empty", ""],
    ["corrupt json", "{not json"],
    ["json null", "null"],
    ["array", "[]"],
    ["wrong version", JSON.stringify({ v: 2, lines: [], prices: {} })],
    ["missing version", JSON.stringify({ lines: [], prices: {} })],
    ["lines not an array", JSON.stringify({ v: 1, lines: {} })],
    ["productId string", wrap([rawLine({ productId: "1" })])],
    ["productId zero", wrap([rawLine({ productId: 0 })])],
    ["productId float", wrap([rawLine({ productId: 1.5 })])],
    ["modifier negative", wrap([rawLine({ modifierIds: [-1] })])],
    ["empty id", wrap([rawLine({ id: "" })])],
    ["id too long", wrap([rawLine({ id: "a".repeat(65) })])],
    ["note too long", wrap([rawLine({ note: "n".repeat(141) })])],
    ["note not a string", wrap([rawLine({ note: 5 })])],
    ["too many modifiers", wrap([rawLine({ modifierIds: Array.from({ length: 31 }, (_, i) => i + 1) })])],
    ["duplicate line ids", wrap([line("a"), line("a")])],
    ["negative price", wrap([], { prices: { a: -1 } })],
    ["fractional price", wrap([], { prices: { a: 1.5 } })],
  ])("returns null on %s", (_name, raw) => {
    expect(parseCart(raw as string | null)).toBeNull();
  });
  it("returns null with more than 100 lines, accepts exactly 100", () => {
    const mk = (n: number) => wrap(Array.from({ length: n }, (_, i) => line(`l${i}`)));
    expect(parseCart(mk(101))).toBeNull();
    expect(parseCart(mk(100))?.lines).toHaveLength(100);
  });
  it("accepts a note of exactly 140 chars", () => {
    expect(parseCart(wrap([line("a", { note: "n".repeat(140) })]))?.lines[0].note).toHaveLength(140);
  });
});

describe("loadCart / saveCart / clearCartStorage", () => {
  it("saves and loads through storage", () => {
    const st = memoryStorage();
    saveCart(st, state([line("a")]), { a: 5 });
    expect(st.data[CART_STORAGE_KEY]).toBeDefined();
    expect(loadCart(st)).toEqual({ lines: [line("a")], prices: { a: 5 } });
  });
  it("load returns null for empty or corrupt storage", () => {
    expect(loadCart(memoryStorage())).toBeNull();
    expect(loadCart(memoryStorage({ [CART_STORAGE_KEY]: "garbage" }))).toBeNull();
  });
  it("saving an empty cart removes the key", () => {
    const st = memoryStorage({ [CART_STORAGE_KEY]: "x" });
    saveCart(st, state([]), {});
    expect(st.data[CART_STORAGE_KEY]).toBeUndefined();
  });
  it("clearCartStorage removes the key", () => {
    const st = memoryStorage({ [CART_STORAGE_KEY]: "x" });
    clearCartStorage(st);
    expect(st.data[CART_STORAGE_KEY]).toBeUndefined();
  });
  it("never throws when storage throws (private mode, quota, denied)", () => {
    const boom = () => {
      throw new Error("denied");
    };
    const bad = { getItem: boom, setItem: boom, removeItem: boom };
    expect(loadCart(bad)).toBeNull();
    expect(() => saveCart(bad, state([line("a")]), {})).not.toThrow();
    expect(() => saveCart(bad, state([]), {})).not.toThrow();
    expect(() => clearCartStorage(bad)).not.toThrow();
  });
  it("never throws when storage is undefined or null", () => {
    expect(loadCart(undefined)).toBeNull();
    expect(loadCart(null)).toBeNull();
    expect(() => saveCart(undefined, state([line("a")]), {})).not.toThrow();
    expect(() => clearCartStorage(undefined)).not.toThrow();
  });
});
