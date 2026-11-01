import { describe, expect, it } from "vitest";
import type { PublicMenu } from "@/lib/menu/public";
import { ranchita } from "./fixtures";
import { pickSuggestions } from "./suggestions";

const p = (id: number, suggest = true) => ({ ...ranchita, id, name: `P${id}`, suggest });
const menu = (...cats: number[][]): PublicMenu => ({
  featured: [],
  categories: cats.map((ids, i) => ({ id: i + 1, name: `C${i + 1}`, slug: `c${i + 1}`, imageUrl: null, products: ids.map((id) => p(id)) })),
});
const ids = (m: PublicMenu, inCart: number[] = []) => pickSuggestions(m, inCart.map((productId) => ({ productId }))).map((x) => x.id);

describe("pickSuggestions", () => {
  it("is empty for an empty menu or with nothing flagged", () => {
    expect(ids({ categories: [], featured: [] })).toEqual([]);
    const m = menu([1, 2]);
    m.categories[0].products.forEach((x) => (x.suggest = false));
    expect(ids(m)).toEqual([]);
  });

  it("keeps menu order across categories and skips unflagged products", () => {
    const m = menu([3, 1], [2]);
    m.categories[0].products[1].suggest = false;
    expect(ids(m)).toEqual([3, 2]);
  });

  it("excludes products already in the cart, whatever the group", () => {
    expect(ids(menu([1, 2, 3]), [2, 2])).toEqual([1, 3]);
  });

  it("is empty when everything is already in the cart", () => {
    expect(ids(menu([1, 2]), [1, 2])).toEqual([]);
  });

  it("caps at 6", () => {
    expect(ids(menu([1, 2, 3, 4], [5, 6, 7, 8]))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("ignores cart groups of products no longer in the menu", () => {
    expect(ids(menu([1]), [99])).toEqual([1]);
  });
});
