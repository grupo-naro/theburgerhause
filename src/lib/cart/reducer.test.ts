import { describe, expect, it } from "vitest";
import { counterIds } from "./fixtures";
import { groupLines } from "./group";
import { MAX_GROUP_QUANTITY, MAX_LINES, MAX_UNITS_PER_ADD, canAdd, cartReducer, emptyCart } from "./reducer";
import { signature } from "./signature";
import type { CartAction, CartState } from "./types";

const unit = (modifierIds: number[] = [], note = "") => ({ modifierIds, note });

function run(actions: CartAction[], start: CartState = emptyCart, newId = counterIds()) {
  return actions.reduce((s, a) => cartReducer(s, a, newId), start);
}

describe("add", () => {
  it("appends one normalized line per unit", () => {
    const s = run([{ type: "add", productId: 1, units: [unit([3, 1, 3], " hola "), unit()] }]);
    expect(s.lines).toEqual([
      { id: "l1", productId: 1, modifierIds: [1, 3], note: "hola" },
      { id: "l2", productId: 1, modifierIds: [], note: "" },
    ]);
  });
  it("2 units with different modifiers -> 2 lines, 2 groups", () => {
    const s = run([{ type: "add", productId: 1, units: [unit([101]), unit([102])] }]);
    expect(s.lines).toHaveLength(2);
    expect(groupLines(s.lines)).toHaveLength(2);
  });
  it("2 identical units -> 1 group of quantity 2 with 2 line ids", () => {
    const s = run([{ type: "add", productId: 1, units: [unit([101]), unit([101])] }]);
    const groups = groupLines(s.lines);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ productId: 1, modifierIds: [101], note: "", quantity: 2, lineIds: ["l1", "l2"] });
    expect(groups[0].signature).toBe(signature(s.lines[0]));
  });
  it("rejects empty units", () => {
    expect(run([{ type: "add", productId: 1, units: [] }])).toBe(emptyCart);
  });
  it("rejects more than 10 units per add (ignored, state unchanged)", () => {
    const units = Array.from({ length: MAX_UNITS_PER_ADD + 1 }, () => unit());
    expect(run([{ type: "add", productId: 1, units }])).toBe(emptyCart);
    expect(canAdd(emptyCart, 1, MAX_UNITS_PER_ADD + 1)).toBe(false);
    expect(canAdd(emptyCart, 1, MAX_UNITS_PER_ADD)).toBe(true);
    expect(canAdd(emptyCart, 1, 0)).toBe(false);
  });
  it("rejects beyond 100 lines", () => {
    let s = emptyCart;
    for (let i = 0; i < MAX_LINES / MAX_UNITS_PER_ADD; i++) {
      s = cartReducer(
        s,
        { type: "add", productId: 1, units: Array.from({ length: 10 }, (_, k) => unit([k + 1000 + i * 10])) },
        counterIds(`p${i}-`),
      );
    }
    expect(s.lines).toHaveLength(MAX_LINES);
    expect(canAdd(s, 1, 1)).toBe(false);
    expect(cartReducer(s, { type: "add", productId: 2, units: [unit()] }, counterIds())).toBe(s);
  });
  it("rejects when a single configuration would exceed 99 units", () => {
    let s = emptyCart;
    const id = counterIds();
    for (let i = 0; i < 9; i++) {
      s = cartReducer(s, { type: "add", productId: 1, units: Array.from({ length: 10 }, () => unit()) }, id);
    }
    s = cartReducer(s, { type: "add", productId: 1, units: Array.from({ length: 9 }, () => unit()) }, id);
    expect(groupLines(s.lines)[0].quantity).toBe(MAX_GROUP_QUANTITY);
    expect(canAdd(s, 1, 1, [unit()])).toBe(false);
    expect(canAdd(s, 1, 1, [unit([101])])).toBe(true);
  });
});

describe("setGroupQuantity", () => {
  const base = run([{ type: "add", productId: 1, units: [unit([101]), unit([202], "x")] }]);
  const sig = (i: number) => signature(base.lines[i]);

  it("increasing clones the configuration with fresh ids", () => {
    const s = cartReducer(base, { type: "setGroupQuantity", signature: sig(1), quantity: 3 }, counterIds("n"));
    const groups = groupLines(s.lines);
    expect(groups[1].quantity).toBe(3);
    expect(s.lines.filter((l) => l.note === "x").map((l) => l.modifierIds)).toEqual([[202], [202], [202]]);
    expect(new Set(s.lines.map((l) => l.id)).size).toBe(s.lines.length);
    expect(groups[0].quantity).toBe(1);
  });
  it("decreasing removes lines from the END of the group", () => {
    const three = run([{ type: "add", productId: 1, units: [unit(), unit(), unit()] }]);
    const s = cartReducer(three, { type: "setGroupQuantity", signature: signature(three.lines[0]), quantity: 1 }, counterIds());
    expect(s.lines.map((l) => l.id)).toEqual(["l1"]);
  });
  it("0 removes the group", () => {
    const s = cartReducer(base, { type: "setGroupQuantity", signature: sig(0), quantity: 0 }, counterIds());
    expect(s.lines.map((l) => l.id)).toEqual(["l2"]);
  });
  it("caps at 99 per group and ignores unknown signatures / invalid quantities", () => {
    const s = cartReducer(base, { type: "setGroupQuantity", signature: sig(0), quantity: 500 }, counterIds("n"));
    expect(groupLines(s.lines)[0].quantity).toBe(MAX_GROUP_QUANTITY);
    expect(cartReducer(base, { type: "setGroupQuantity", signature: "nope", quantity: 3 }, counterIds())).toBe(base);
    expect(cartReducer(base, { type: "setGroupQuantity", signature: sig(0), quantity: Number.NaN }, counterIds())).toBe(base);
  });
  it("never lets the cart grow past 100 lines", () => {
    const s0 = run([{ type: "add", productId: 1, units: [unit()] }]);
    const s1 = cartReducer(s0, { type: "setGroupQuantity", signature: signature(s0.lines[0]), quantity: 99 }, counterIds("a"));
    const other = cartReducer(s1, { type: "add", productId: 2, units: [unit()] }, counterIds("b"));
    const s2 = cartReducer(
      other,
      { type: "setGroupQuantity", signature: signature(other.lines[other.lines.length - 1]), quantity: 50 },
      counterIds("c"),
    );
    expect(s2.lines.length).toBe(MAX_LINES);
  });
});

describe("remove / replace / clear", () => {
  const base = run([
    { type: "add", productId: 1, units: [unit([101]), unit([101])] },
    { type: "add", productId: 2, units: [unit()] },
    { type: "add", productId: 1, units: [unit([102])] },
  ]);

  it("removeLine removes one unit", () => {
    expect(cartReducer(base, { type: "removeLine", id: "l1" }, counterIds()).lines.map((l) => l.id)).toEqual(["l2", "l3", "l4"]);
  });
  it("removeGroup removes every line of the signature", () => {
    const s = cartReducer(base, { type: "removeGroup", signature: signature(base.lines[0]) }, counterIds());
    expect(s.lines.map((l) => l.id)).toEqual(["l3", "l4"]);
  });
  it("replaceGroup keeps the position and handles a different number of units", () => {
    const s = cartReducer(
      base,
      { type: "replaceGroup", signature: signature(base.lines[0]), productId: 1, units: [unit([201]), unit([202]), unit([202])] },
      counterIds("n"),
    );
    expect(s.lines.map((l) => [l.productId, l.modifierIds])).toEqual([
      [1, [201]],
      [1, [202]],
      [1, [202]],
      [2, []],
      [1, [102]],
    ]);
    const fewer = cartReducer(
      base,
      { type: "replaceGroup", signature: signature(base.lines[0]), productId: 1, units: [unit([201])] },
      counterIds("n"),
    );
    expect(fewer.lines.map((l) => l.productId)).toEqual([1, 2, 1]);
    expect(fewer.lines[0].modifierIds).toEqual([201]);
  });
  it("increasing a quantity places the clones right after the group's last unit", () => {
    // lines: A(l1) B(l2) A(l3) -> group A is non-contiguous; clones go after l3
    const s = run([
      { type: "add", productId: 1, units: [unit([101])] },
      { type: "add", productId: 2, units: [unit()] },
      { type: "add", productId: 1, units: [unit([101])] },
    ]);
    const out = cartReducer(s, { type: "setGroupQuantity", signature: signature(s.lines[0]), quantity: 3 }, counterIds("n"));
    expect(out.lines.map((l) => l.id)).toEqual(["l1", "l2", "l3", "n1"]);
  });
  it("replaceGroup on a non-contiguous group puts the replacement at the FIRST position of that group", () => {
    const s = run([
      { type: "add", productId: 1, units: [unit([101])] },
      { type: "add", productId: 2, units: [unit()] },
      { type: "add", productId: 1, units: [unit([101])] },
    ]);
    const out = cartReducer(s, { type: "replaceGroup", signature: signature(s.lines[0]), productId: 1, units: [unit([102])] }, counterIds("n"));
    expect(out.lines.map((l) => [l.productId, l.modifierIds])).toEqual([[1, [102]], [2, []]]);
  });
  it("replaceGroup rejects empty units and unknown signatures", () => {
    expect(cartReducer(base, { type: "replaceGroup", signature: signature(base.lines[0]), productId: 1, units: [] }, counterIds())).toBe(base);
    expect(cartReducer(base, { type: "replaceGroup", signature: "nope", productId: 1, units: [unit()] }, counterIds())).toBe(base);
  });
  it("clear empties the cart", () => {
    expect(cartReducer(base, { type: "clear" }, counterIds()).lines).toEqual([]);
  });
});

describe("hydrate", () => {
  it("replaces the lines, normalizing and capping at 100", () => {
    const lines = Array.from({ length: 120 }, (_, i) => ({ id: `h${i}`, productId: 1, modifierIds: [3, 1], note: " a " }));
    const s = cartReducer(emptyCart, { type: "hydrate", lines }, counterIds());
    expect(s.lines).toHaveLength(MAX_LINES);
    expect(s.lines[0]).toEqual({ id: "h0", productId: 1, modifierIds: [1, 3], note: "a" });
  });
});

describe("groupLines", () => {
  it("returns copies: mutating a group does not change the state", () => {
    const s = run([{ type: "add", productId: 1, units: [unit([101, 102])] }]);
    const [g] = groupLines(s.lines);
    g.modifierIds.push(999);
    g.lineIds.push("x");
    expect(s.lines[0].modifierIds).toEqual([101, 102]);
  });
  it("groups by signature in first-appearance order, keeping relative line order", () => {
    const s = run([
      { type: "add", productId: 1, units: [unit([101])] },
      { type: "add", productId: 2, units: [unit()] },
      { type: "add", productId: 1, units: [unit([101])] },
    ]);
    const g = groupLines(s.lines);
    expect(g.map((x) => [x.productId, x.quantity, x.lineIds])).toEqual([
      [1, 2, ["l1", "l3"]],
      [2, 1, ["l2"]],
    ]);
  });
});

describe("restore (undo of a removal)", () => {
  const seeded = () =>
    run([
      { type: "add", productId: 1, units: [unit([101]), unit([101])] },
      { type: "add", productId: 2, units: [unit()] },
      { type: "add", productId: 3, units: [unit()] },
    ]);

  it("puts a removed group back at its original position", () => {
    const before = seeded();
    const sig = signature(before.lines[0]);
    const removed = before.lines.map((line, index) => ({ line, index })).filter((i) => signature(i.line) === sig);
    const without = cartReducer(before, { type: "removeGroup", signature: sig }, counterIds());
    expect(without.lines.map((l) => l.productId)).toEqual([2, 3]);
    const back = cartReducer(without, { type: "restore", items: removed }, counterIds());
    expect(back).toEqual(before);
  });

  it("is ignored when it would exceed the line limit", () => {
    const full = run([{ type: "add", productId: 1, units: [unit()] }]);
    const items = Array.from({ length: MAX_LINES }, (_, i) => ({
      index: 0,
      line: { id: `x${i}`, productId: 9, modifierIds: [], note: "" },
    }));
    expect(cartReducer(full, { type: "restore", items }, counterIds())).toBe(full);
  });
});
