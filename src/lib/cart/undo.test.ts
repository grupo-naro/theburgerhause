import { describe, expect, it } from "vitest";
import { signature } from "./signature";
import { isUndoExpired, restoreRemoved, takeGroup, UNDO_TTL_MS } from "./undo";
import type { CartLine } from "./types";

const line = (id: string, productId: number, modifierIds: number[] = []): CartLine => ({
  id,
  productId,
  modifierIds,
  note: "",
});

describe("takeGroup", () => {
  it("removes every unit of the group and remembers their original positions", () => {
    const lines = [line("a", 1), line("b", 2), line("c", 1), line("d", 3)];
    const taken = takeGroup(lines, signature(lines[0]), 1000);
    expect(taken?.lines.map((l) => l.id)).toEqual(["b", "d"]);
    expect(taken?.entry.items).toEqual([
      { index: 0, line: lines[0] },
      { index: 2, line: lines[2] },
    ]);
    expect(taken?.entry.at).toBe(1000);
  });

  it("returns null for an unknown signature", () => {
    expect(takeGroup([line("a", 1)], "nope", 0)).toBeNull();
  });
});

describe("restoreRemoved", () => {
  it("re-inserts the group at its original position", () => {
    const lines = [line("a", 1), line("b", 2), line("c", 1), line("d", 3)];
    const taken = takeGroup(lines, signature(lines[0]), 0)!;
    expect(restoreRemoved(taken.lines, taken.entry.items).map((l) => l.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("restores a middle group and a last group in place", () => {
    const lines = [line("a", 1), line("b", 2), line("c", 3)];
    const mid = takeGroup(lines, signature(lines[1]), 0)!;
    expect(restoreRemoved(mid.lines, mid.entry.items).map((l) => l.id)).toEqual(["a", "b", "c"]);
    const last = takeGroup(lines, signature(lines[2]), 0)!;
    expect(restoreRemoved(last.lines, last.entry.items).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("clamps the position when the cart got shorter in the meantime", () => {
    const lines = [line("a", 1), line("b", 2), line("c", 3)];
    const taken = takeGroup(lines, signature(lines[2]), 0)!;
    expect(restoreRemoved([line("x", 9)], taken.entry.items).map((l) => l.id)).toEqual(["x", "c"]);
  });

  it("never duplicates a unit that is already back in the cart", () => {
    const lines = [line("a", 1), line("b", 2)];
    const taken = takeGroup(lines, signature(lines[0]), 0)!;
    const once = restoreRemoved(taken.lines, taken.entry.items);
    expect(restoreRemoved(once, taken.entry.items).map((l) => l.id)).toEqual(["a", "b"]);
  });
});

describe("isUndoExpired", () => {
  it("is false until the TTL has passed and true afterwards", () => {
    const entry = { items: [], at: 1000 };
    expect(isUndoExpired(entry, 1000)).toBe(false);
    expect(isUndoExpired(entry, 1000 + UNDO_TTL_MS - 1)).toBe(false);
    expect(isUndoExpired(entry, 1000 + UNDO_TTL_MS)).toBe(true);
  });

  it("treats a missing entry as expired", () => {
    expect(isUndoExpired(null, 0)).toBe(true);
  });
});
