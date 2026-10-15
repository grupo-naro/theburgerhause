import { describe, expect, it } from "vitest";
import { menuFixture } from "./fixtures";
import { buildMenuIndex } from "./pricing";
import { reconcileCart, toggleModifierInUnit } from "./reconcile";
import type { CartLine } from "./types";

const index = buildMenuIndex(menuFixture);
const line = (id: string, productId: number, modifierIds: number[] = [], note = ""): CartLine => ({ id, productId, modifierIds, note });

describe("reconcileCart", () => {
  it("keeps a valid cart untouched with no issues", () => {
    const lines = [line("a", 1, [101, 201]), line("b", 2)];
    const r = reconcileCart(lines, index);
    expect(r.lines).toEqual(lines);
    expect(r.issues).toEqual([]);
    expect(r.prices).toEqual({ a: 970000, b: 400000 });
  });
  it("drops lines of a product that no longer exists (named when known)", () => {
    const r = reconcileCart([line("a", 77), line("b", 77), line("c", 2)], index, { names: { 77: "Burger vieja" } });
    expect(r.lines.map((l) => l.id)).toEqual(["c"]);
    expect(r.issues).toEqual([{ type: "product_unavailable", productId: 77, name: "Burger vieja", quantity: 2 }]);
  });
  it("strips modifiers that are gone, keeps the line and its quantity", () => {
    const r = reconcileCart([line("a", 1, [101, 999], "x"), line("b", 1, [101, 999], "x")], index);
    expect(r.lines).toEqual([line("a", 1, [101], "x"), line("b", 1, [101], "x")]);
    expect(r.issues).toEqual([{ type: "modifier_unavailable", productId: 1, modifierIds: [999], quantity: 2 }]);
  });
  it("flags price changes against the last seen unit prices (keyed by line id)", () => {
    const r = reconcileCart([line("a", 1), line("b", 2)], index, { lastSeenPrices: { a: 800000, b: 400000 } });
    expect(r.issues).toEqual([{ type: "price_changed", productId: 1, from: 800000, to: 850000, quantity: 1 }]);
    expect(r.prices).toEqual({ a: 850000, b: 400000 });
  });
  it("is idempotent: reconciling the result again yields no issues", () => {
    const first = reconcileCart([line("a", 77), line("b", 1, [999]), line("c", 1)], index, { lastSeenPrices: { c: 1 } });
    expect(first.issues.length).toBeGreaterThan(0);
    const second = reconcileCart(first.lines, index, { lastSeenPrices: first.prices });
    expect(second.issues).toEqual([]);
    expect(second.lines).toEqual(first.lines);
  });
  it("never throws on an empty menu", () => {
    const r = reconcileCart([line("a", 1)], buildMenuIndex({ categories: [], featured: [] }));
    expect(r.lines).toEqual([]);
  });
});

describe("toggleModifierInUnit", () => {
  const mod = (id: number) => index.modifiers.get(id)!.modifier;
  it("remove and add kinds toggle freely", () => {
    let sel: number[] = [];
    sel = toggleModifierInUnit(sel, mod(102), index);
    sel = toggleModifierInUnit(sel, mod(101), index);
    sel = toggleModifierInUnit(sel, mod(201), index);
    expect(sel).toEqual([101, 102, 201]);
    expect(toggleModifierInUnit(sel, mod(101), index)).toEqual([102, 201]);
  });
  it("two swaps of the same group are exclusive", () => {
    let sel = toggleModifierInUnit([], mod(301), index);
    sel = toggleModifierInUnit(sel, mod(302), index);
    expect(sel).toEqual([302]);
  });
  it("selecting the selected swap deselects it", () => {
    expect(toggleModifierInUnit([301], mod(301), index)).toEqual([]);
  });
  it("swaps in different groups are independent and other kinds are untouched", () => {
    expect(toggleModifierInUnit([301, 101, 201], mod(311), index)).toEqual([101, 201, 301, 311]);
  });
  it("does not mutate its input and returns sorted ids", () => {
    const input = [302, 101];
    const out = toggleModifierInUnit(input, mod(201), index);
    expect(input).toEqual([302, 101]);
    expect(out).toEqual([101, 201, 302]);
  });
});
