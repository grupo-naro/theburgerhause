import { describe, expect, it } from "vitest";
import { normalizeLine, normalizeModifierIds, normalizeNote } from "./normalize";
import { signature } from "./signature";

describe("normalize", () => {
  it("sorts and de-duplicates modifier ids", () => {
    expect(normalizeModifierIds([5, 2, 5, 3, 2])).toEqual([2, 3, 5]);
  });
  it("trims the note and caps it at 140 chars", () => {
    expect(normalizeNote("  sin sal  ")).toBe("sin sal");
    expect(normalizeNote("x".repeat(200))).toHaveLength(140);
  });
  it("normalizeLine applies both", () => {
    expect(normalizeLine({ id: "a", productId: 1, modifierIds: [3, 1, 3], note: " hola " })).toEqual({
      id: "a",
      productId: 1,
      modifierIds: [1, 3],
      note: "hola",
    });
  });
});

describe("signature", () => {
  it("is productId|sorted ids|note", () => {
    expect(signature({ productId: 7, modifierIds: [3, 1], note: "sin sal" })).toBe("7|1,3|sin sal");
  });
  it("ignores the order of modifier ids and duplicates", () => {
    const a = signature({ productId: 1, modifierIds: [2, 1, 2], note: "" });
    const b = signature({ productId: 1, modifierIds: [1, 2], note: "" });
    expect(a).toBe(b);
  });
  it("trims and collapses whitespace in the note but stays case-sensitive", () => {
    expect(signature({ productId: 1, modifierIds: [], note: "  sin   sal \n por favor " })).toBe(
      signature({ productId: 1, modifierIds: [], note: "sin sal por favor" }),
    );
    expect(signature({ productId: 1, modifierIds: [], note: "Sin sal" })).not.toBe(
      signature({ productId: 1, modifierIds: [], note: "sin sal" }),
    );
  });
  it("differs by product and by modifiers", () => {
    expect(signature({ productId: 1, modifierIds: [], note: "" })).not.toBe(
      signature({ productId: 2, modifierIds: [], note: "" }),
    );
    expect(signature({ productId: 1, modifierIds: [1], note: "" })).not.toBe(
      signature({ productId: 1, modifierIds: [], note: "" }),
    );
  });
});
