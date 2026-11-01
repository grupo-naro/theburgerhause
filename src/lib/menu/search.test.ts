import { describe, expect, it } from "vitest";
import { filterMenu, normalizeSearchText } from "./search";
import type { PublicCategory, PublicMenu, PublicProduct } from "./public";

const product = (id: number, name: string, description: string | null = null): PublicProduct => ({
  id,
  categoryId: 1,
  name,
  description,
  price: 100,
  imagePath: null,
  imageUrl: null,
  thumbUrl: null,
  featured: id === 1,
  suggest: false,
  modifierGroups: [],
});
const category = (id: number, name: string, products: PublicProduct[]): PublicCategory => ({
  id,
  name,
  slug: name.toLowerCase(),
  imageUrl: null,
  products,
});

const menu: PublicMenu = {
  categories: [
    category(1, "Simples", [
      product(1, "Ranchita simple", "Carne y cheddar"),
      product(2, "Cuarto de libra", "Con pickles"),
    ]),
    category(2, "Kids", [product(3, "Cajita Kids", "Papas y hamburguesa pequeña")]),
    category(3, "Sándwich", [product(4, "Mila completa", null)]),
  ],
  featured: [],
};

describe("normalizeSearchText", () => {
  it("lowercases, strips diacritics, trims and collapses spaces", () => {
    expect(normalizeSearchText("  SÁNDWICH   de  Milá ")).toBe("sandwich de mila");
    expect(normalizeSearchText("Ñandú")).toBe("nandu");
  });
  it("returns an empty string for blanks", () => {
    expect(normalizeSearchText("   ")).toBe("");
  });
});

describe("filterMenu", () => {
  it("returns the same menu for an empty query", () => {
    expect(filterMenu(menu, "  ")).toBe(menu);
  });
  it("matches names case- and accent-insensitively", () => {
    const out = filterMenu(menu, "RANCHITA");
    expect(out.categories.map((c) => c.name)).toEqual(["Simples"]);
    expect(out.categories[0].products.map((p) => p.id)).toEqual([1]);
    expect(filterMenu(menu, "MILÁ").categories[0].name).toBe("Sándwich");
    expect(filterMenu(menu, "pequena").categories[0].products[0].id).toBe(3);
  });
  it("matches descriptions", () => {
    expect(filterMenu(menu, "pickles").categories[0].products.map((p) => p.id)).toEqual([2]);
  });
  it("requires every word to match (any field)", () => {
    expect(filterMenu(menu, "ranchita cheddar").categories[0].products.map((p) => p.id)).toEqual([1]);
    expect(filterMenu(menu, "ranchita pickles").categories).toEqual([]);
  });
  it("keeps order and drops empty categories", () => {
    const out = filterMenu(menu, "a");
    expect(out.categories.map((c) => c.id)).toEqual([1, 2, 3]);
    const only = filterMenu(menu, "kids");
    expect(only.categories.map((c) => c.id)).toEqual([2]);
  });
  it("returns no categories when nothing matches", () => {
    expect(filterMenu(menu, "zzz").categories).toEqual([]);
  });
  it("filters featured too", () => {
    const withFeatured = { ...menu, featured: [menu.categories[0].products[0]] };
    expect(filterMenu(withFeatured, "kids").featured).toEqual([]);
  });
});
