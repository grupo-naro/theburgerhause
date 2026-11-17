import { describe, expect, it } from "vitest";
import { groupInputSchema, modifierInputSchema } from "./schemas";

const base = { groupId: 1, name: "Sin cheddar", kind: "remove", priceArs: 0, active: true } as const;

describe("groupInputSchema", () => {
  it("trims and bounds the name", () => {
    expect(groupInputSchema.parse({ name: "  Papas " }).name).toBe("Papas");
    expect(groupInputSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(groupInputSchema.safeParse({ name: "a".repeat(81) }).success).toBe(false);
  });
});

describe("modifierInputSchema", () => {
  it("stores the kitchen label uppercase (derived or explicit)", () => {
    expect(modifierInputSchema.parse(base).kitchenLabel).toBe("SIN CHEDDAR");
    expect(modifierInputSchema.parse({ ...base, kitchenLabel: " sin  cheddar " }).kitchenLabel).toBe("SIN CHEDDAR");
  });
  it("rejects a remove modifier with a price", () => {
    const r = modifierInputSchema.safeParse({ ...base, priceArs: 100 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]).toMatchObject({ path: ["priceArs"], message: "Un quite no puede tener precio" });
  });
  it("allows priced add/swap and rejects negatives and fractions", () => {
    expect(modifierInputSchema.safeParse({ ...base, kind: "add", priceArs: 1200 }).success).toBe(true);
    expect(modifierInputSchema.safeParse({ ...base, kind: "swap", priceArs: 0 }).success).toBe(true);
    expect(modifierInputSchema.safeParse({ ...base, kind: "add", priceArs: -1 }).success).toBe(false);
    expect(modifierInputSchema.safeParse({ ...base, kind: "add", priceArs: 10.5 }).success).toBe(false);
    expect(modifierInputSchema.safeParse({ ...base, kind: "add", priceArs: Number.NaN }).success).toBe(false);
  });
  it("validates kind, group, name and label bounds", () => {
    expect(modifierInputSchema.safeParse({ ...base, kind: "other" }).success).toBe(false);
    expect(modifierInputSchema.safeParse({ ...base, groupId: 0 }).success).toBe(false);
    expect(modifierInputSchema.safeParse({ ...base, name: " " }).success).toBe(false);
    expect(modifierInputSchema.safeParse({ ...base, name: "a".repeat(81) }).success).toBe(false);
    expect(modifierInputSchema.safeParse({ ...base, kitchenLabel: "a".repeat(61) }).success).toBe(false);
    expect(modifierInputSchema.safeParse({ ...base, kind: "swap", name: "a".repeat(70) }).success).toBe(false);
  });
});

describe("modifierInputSchema cost", () => {
  const add = { groupId: 1, name: "+ Dips", kind: "add", priceArs: 1200, active: true } as const;
  it("an extra accepts a cost, zero, null and undefined", () => {
    for (const costArs of [400, 0, null, undefined]) expect(modifierInputSchema.safeParse({ ...add, costArs }).success, String(costArs)).toBe(true);
  });
  it("a removal cannot have a cost", () => {
    const r = modifierInputSchema.safeParse({ ...base, costArs: 0 });
    expect(r.success).toBe(false);
    expect(!r.success && r.error.issues.find((i) => i.path[0] === "costArs")?.message).toBe("Un quite no puede tener costo");
    expect(modifierInputSchema.safeParse({ ...base, costArs: null }).success).toBe(true);
  });
});
