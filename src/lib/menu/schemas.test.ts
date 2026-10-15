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
