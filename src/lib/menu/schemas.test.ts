import { describe, expect, it } from "vitest";
import { categoryInputSchema, productInputSchema } from "./schemas";

const UUID = "123e4567-e89b-42d3-a456-426614174000.webp";
const prod = { categoryId: 1, name: "Doble", priceArs: 14400, active: true, featured: false };

describe("categoryInputSchema", () => {
  it("trims the name and derives the slug", () => {
    const r = categoryInputSchema.parse({ name: "  Hamburguesas ", active: true });
    expect(r.name).toBe("Hamburguesas");
    expect(r.slug).toBe("hamburguesas");
  });
  it("keeps an explicit slug normalised", () => {
    expect(categoryInputSchema.parse({ name: "X", slug: "Mi Slug", active: true }).slug).toBe("mi-slug");
  });
  it("rejects empty, blank and too long names", () => {
    expect(categoryInputSchema.safeParse({ name: "   ", active: true }).success).toBe(false);
    expect(categoryInputSchema.safeParse({ name: "a".repeat(81), active: true }).success).toBe(false);
  });
  it("rejects a name that yields an empty slug", () => {
    expect(categoryInputSchema.safeParse({ name: "???", active: true }).success).toBe(false);
  });
  it("validates imagePath", () => {
    expect(categoryInputSchema.safeParse({ name: "A", active: true, imagePath: UUID }).success).toBe(true);
    expect(categoryInputSchema.safeParse({ name: "A", active: true, imagePath: null }).success).toBe(true);
    expect(categoryInputSchema.safeParse({ name: "A", active: true, imagePath: "../etc/passwd" }).success).toBe(false);
  });
});

describe("productInputSchema", () => {
  it("accepts a valid product and defaults the description", () => {
    const r = productInputSchema.parse(prod);
    expect(r.description).toBe("");
    expect(r.priceArs).toBe(14400);
  });
  it.each([-1, 10.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects price %s", (priceArs) => {
    expect(productInputSchema.safeParse({ ...prod, priceArs }).success).toBe(false);
  });
  it("trims the name and rejects empty / long values", () => {
    expect(productInputSchema.parse({ ...prod, name: "  Doble  " }).name).toBe("Doble");
    expect(productInputSchema.safeParse({ ...prod, name: " " }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...prod, name: "a".repeat(121) }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...prod, description: "a".repeat(501) }).success).toBe(false);
  });
  it("requires an integer categoryId", () => {
    expect(productInputSchema.safeParse({ ...prod, categoryId: 1.5 }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...prod, categoryId: "x" }).success).toBe(false);
  });
  it("rejects a bad imagePath", () => {
    expect(productInputSchema.safeParse({ ...prod, imagePath: "nope.png" }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...prod, imagePath: UUID }).success).toBe(true);
  });
});

describe("productInputSchema cost", () => {
  it("accepts a whole non-negative cost, zero, null (clear) and undefined (keep)", () => {
    for (const costArs of [1500, 0, null, undefined]) expect(productInputSchema.safeParse({ ...prod, costArs }).success, String(costArs)).toBe(true);
  });
  it("rejects negative, fractional and too-high costs with the price's messages", () => {
    const msg = (costArs: number) => {
      const r = productInputSchema.safeParse({ ...prod, costArs });
      return r.success ? undefined : r.error.issues.find((i) => i.path[0] === "costArs")?.message;
    };
    expect(msg(-1)).toBe("El costo no puede ser negativo");
    expect(msg(1.5)).toBe("El costo debe ser en pesos enteros");
    expect(msg(100_000_001)).toBe("Costo demasiado alto");
  });
});

describe("productInputSchema patties", () => {
  const msg = (patties: number) => {
    const r = productInputSchema.safeParse({ ...prod, patties });
    return r.success ? undefined : r.error.issues.find((i) => i.path[0] === "patties")?.message;
  };
  it("accepts 0 to 3 and undefined (keep)", () => {
    for (const patties of [0, 1, 2, 3, undefined]) expect(productInputSchema.safeParse({ ...prod, patties }).success, String(patties)).toBe(true);
  });
  it("rejects out of range and fractions", () => {
    expect(msg(4)).toBe("Entre 0 y 3 medallones");
    expect(msg(-1)).toBe("Entre 0 y 3 medallones");
    expect(msg(1.5)).toBe("Los medallones son un número entero");
  });
});
