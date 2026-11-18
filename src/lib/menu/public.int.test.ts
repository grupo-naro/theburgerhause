import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { loadMenu } from "./public";

beforeEach(resetDb);
afterAll(closeDb);

const IMG = "0b9f2f5e-1c3a-4d2b-8e7f-123456789abc.webp";

async function cat(name: string, sort = 0, active = true, imagePath: string | null = null) {
  const [row] = await testDb()
    .insert(s.categories)
    .values({ name, slug: name.toLowerCase().replace(/\s+/g, "-"), sort, active, imagePath })
    .returning();
  return row;
}

async function prod(
  categoryId: number,
  name: string,
  o: Partial<typeof s.products.$inferInsert> = {},
) {
  const [row] = await testDb()
    .insert(s.products)
    .values({ categoryId, name, price: 100000, ...o })
    .returning();
  return row;
}

async function group(name: string) {
  const [row] = await testDb().insert(s.modifierGroups).values({ name }).returning();
  return row;
}

async function mod(
  groupId: number,
  name: string,
  o: Partial<typeof s.modifiers.$inferInsert> = {},
) {
  const [row] = await testDb()
    .insert(s.modifiers)
    .values({ groupId, name, kind: "add", kitchenLabel: name.toUpperCase(), ...o })
    .returning();
  return row;
}

const link = (productId: number, groupId: number) =>
  testDb().insert(s.productModifierGroups).values({ productId, groupId });

describe("loadMenu", () => {
  it("returns an empty menu when there is nothing", async () => {
    expect(await loadMenu(testDb())).toEqual({ categories: [], featured: [] });
  });

  it("excludes inactive categories and inactive products", async () => {
    const a = await cat("A", 0);
    const off = await cat("Off", 1, false);
    await prod(a.id, "Visible");
    await prod(a.id, "Hidden", { active: false });
    await prod(off.id, "In inactive category");
    const menu = await loadMenu(testDb());
    expect(menu.categories.map((c) => c.name)).toEqual(["A"]);
    expect(menu.categories[0].products.map((p) => p.name)).toEqual(["Visible"]);
  });

  it("omits categories without active products", async () => {
    const a = await cat("A", 0);
    const empty = await cat("Empty", 1);
    const allOff = await cat("AllOff", 2);
    await prod(a.id, "P");
    await prod(allOff.id, "Q", { active: false });
    const menu = await loadMenu(testDb());
    expect(menu.categories.map((c) => c.name)).toEqual(["A"]);
    expect(empty.id).toBeGreaterThan(0);
  });

  it("orders categories and products by sort (then id)", async () => {
    const b = await cat("B", 2);
    const a = await cat("A", 1);
    await prod(a.id, "P2", { sort: 2 });
    await prod(a.id, "P1", { sort: 1 });
    await prod(b.id, "Z", { sort: 0 });
    const menu = await loadMenu(testDb());
    expect(menu.categories.map((c) => c.name)).toEqual(["A", "B"]);
    expect(menu.categories[0].products.map((p) => p.name)).toEqual(["P1", "P2"]);
  });

  it("exposes the suggest flag and never lists paused products", async () => {
    const a = await cat("A", 0);
    await prod(a.id, "Sugerido", { suggest: true });
    await prod(a.id, "Comun", { sort: 1 });
    await prod(a.id, "Sugerido-off", { suggest: true, active: false, sort: 2 });
    const menu = await loadMenu(testDb());
    expect(menu.categories[0].products.map((p) => [p.name, p.suggest])).toEqual([
      ["Sugerido", true],
      ["Comun", false],
    ]);
  });

  it("lists featured active products in menu order", async () => {
    const a = await cat("A", 0);
    const b = await cat("B", 1);
    await prod(b.id, "B-feat", { featured: true });
    await prod(a.id, "A-feat2", { featured: true, sort: 2 });
    await prod(a.id, "A-feat1", { featured: true, sort: 1 });
    await prod(a.id, "A-plain", { sort: 3 });
    await prod(a.id, "A-feat-off", { featured: true, active: false });
    const menu = await loadMenu(testDb());
    expect(menu.featured.map((p) => p.name)).toEqual(["A-feat1", "A-feat2", "B-feat"]);
    expect(menu.featured.every((p) => p.featured)).toBe(true);
  });

  it("exposes prices in cents, description and image urls", async () => {
    const a = await cat("A", 0, true, IMG);
    await prod(a.id, "With", { price: 850000, description: "Rica", imagePath: IMG });
    await prod(a.id, "Without", { description: null });
    const menu = await loadMenu(testDb());
    const [withImg, without] = menu.categories[0].products;
    expect(withImg.price).toBe(850000);
    expect(withImg.description).toBe("Rica");
    expect(withImg.imagePath).toBe(IMG);
    expect(withImg.imageUrl).toBe(`/uploads/${IMG}`);
    expect(withImg.thumbUrl).toBe(`/uploads/${IMG.replace(".webp", ".thumb.webp")}`);
    expect(without).toMatchObject({ description: null, imagePath: null, imageUrl: null, thumbUrl: null });
    expect(menu.categories[0].imageUrl).toBe(`/uploads/${IMG}`);
  });

  it("includes only active modifiers, drops groups with none, orders groups by id and modifiers by sort", async () => {
    const a = await cat("A", 0);
    const p = await prod(a.id, "Burger");
    const g1 = await group("G1");
    const g2 = await group("G2");
    const g3 = await group("G3-all-inactive");
    await mod(g1.id, "m-second", { sort: 2 });
    await mod(g1.id, "m-first", { sort: 1, kind: "remove" });
    await mod(g1.id, "m-off", { sort: 0, active: false });
    await mod(g2.id, "g2-mod", { priceDelta: 30000 });
    await mod(g3.id, "ghost", { active: false });
    // link in reverse order: result must still follow group id
    await link(p.id, g3.id);
    await link(p.id, g2.id);
    await link(p.id, g1.id);
    const [prodOut] = (await loadMenu(testDb())).categories[0].products;
    expect(prodOut.modifierGroups.map((g) => g.name)).toEqual(["G1", "G2"]);
    expect(prodOut.modifierGroups[0].modifiers.map((m) => m.name)).toEqual(["m-first", "m-second"]);
    expect(prodOut.modifierGroups[0].modifiers[0]).toEqual({
      id: expect.any(Number),
      name: "m-first",
      kind: "remove",
      priceDelta: 0,
    });
    expect(prodOut.modifierGroups[1].modifiers[0].priceDelta).toBe(30000);
  });

  it("gives modifierGroups: [] to a product without groups", async () => {
    const a = await cat("A", 0);
    await prod(a.id, "Plain");
    const [p] = (await loadMenu(testDb())).categories[0].products;
    expect(p.modifierGroups).toEqual([]);
  });

  it("never leaks internal fields (kitchenLabel, active, sort)", async () => {
    const a = await cat("A", 0);
    const p = await prod(a.id, "Burger", { featured: true });
    const g = await group("G");
    await mod(g.id, "Extra", { kitchenLabel: "EXTRA SECRETO" });
    await link(p.id, g.id);
    const menu = await loadMenu(testDb());
    const json = JSON.stringify(menu);
    expect(json).not.toContain("kitchenLabel");
    expect(json).not.toContain("EXTRA SECRETO");
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(menu.categories[0])).toEqual(["id", "imageUrl", "name", "products", "slug"]);
    expect(keys(menu.categories[0].products[0])).toEqual(
      ["categoryId", "description", "featured", "id", "imagePath", "imageUrl", "modifierGroups", "name", "price", "suggest", "thumbUrl"].sort(),
    );
    expect(keys(menu.categories[0].products[0].modifierGroups[0].modifiers[0])).toEqual([
      "id",
      "kind",
      "name",
      "priceDelta",
    ]);
  });
});

describe("combos in the public menu", () => {
  const products = (m: Awaited<ReturnType<typeof loadMenu>>) => m.categories.flatMap((c) => c.products);
  it("a combo lists what it includes; a plain product has no list", async () => {
    const c = await cat("Combos");
    const burger = await prod(c.id, "Holtber simple");
    const coke = await prod(c.id, "Coca 500");
    const combo = await prod(c.id, "Combo mundial");
    await testDb().insert(s.comboItems).values([
      { comboId: combo.id, productId: burger.id, quantity: 1, sort: 0 },
      { comboId: combo.id, productId: coke.id, quantity: 1, sort: 1 },
    ]);
    const menu = await loadMenu(testDb());
    expect(products(menu).find((p) => p.id === combo.id)?.includes).toEqual([
      { name: "Holtber simple", quantity: 1 },
      { name: "Coca 500", quantity: 1 },
    ]);
    expect(products(menu).find((p) => p.id === burger.id)?.includes).toBeUndefined();
  });
  it("a combo is hidden while something inside it is paused, out of stock or in a hidden category", async () => {
    const c = await cat("Combos");
    const hidden = await cat("Ocultas", 1, false);
    const burger = await prod(c.id, "Holtber simple");
    const coke = await prod(c.id, "Coca 500");
    const secret = await prod(hidden.id, "Salsa secreta");
    const combo = await prod(c.id, "Combo mundial");
    await testDb().insert(s.comboItems).values([
      { comboId: combo.id, productId: burger.id, quantity: 1 },
      { comboId: combo.id, productId: coke.id, quantity: 1 },
    ]);
    const has = async () => products(await loadMenu(testDb())).some((p) => p.id === combo.id);
    expect(await has()).toBe(true);
    await testDb().update(s.products).set({ stockPaused: true }).where(eq(s.products.id, coke.id));
    expect(await has()).toBe(false);
    await testDb().update(s.products).set({ stockPaused: false, active: false }).where(eq(s.products.id, burger.id));
    expect(await has()).toBe(false);
    await testDb().update(s.products).set({ active: true }).where(eq(s.products.id, burger.id));
    await testDb().insert(s.comboItems).values({ comboId: combo.id, productId: secret.id, quantity: 1 });
    expect(await has()).toBe(false);
  });
});
