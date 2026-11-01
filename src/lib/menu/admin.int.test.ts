import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import {
  moveCategory,
  moveProduct,
  saveCategory,
  saveProduct,
  setCategoryActive,
  setProductActive,
  setProductFeatured,
} from "./admin";

const db = () => testDb();
const img = (n: number) => `123e4567-e89b-42d3-a456-42661417400${n}.webp`;
const deleter = () => vi.fn<(name: string) => Promise<void>>(async () => {});

async function cat(name: string, extra: Record<string, unknown> = {}) {
  const r = await saveCategory(db(), { name, active: true, ...extra });
  if (!r.ok) throw new Error(`category failed: ${JSON.stringify(r)}`);
  return r.data.id;
}
async function prod(categoryId: number, name: string, extra: Record<string, unknown> = {}) {
  const r = await saveProduct(db(), { categoryId, name, priceArs: 1000, active: true, featured: false, ...extra });
  if (!r.ok) throw new Error(`product failed: ${JSON.stringify(r)}`);
  return r.data.id;
}
const productRow = async (id: number) => (await db().select().from(s.products).where(eq(s.products.id, id)))[0];
const categoryRow = async (id: number) => (await db().select().from(s.categories).where(eq(s.categories.id, id)))[0];
const namesByOrder = async (categoryId: number) =>
  (
    await db()
      .select()
      .from(s.products)
      .where(eq(s.products.categoryId, categoryId))
      .orderBy(asc(s.products.sort), asc(s.products.id))
  ).map((p) => p.name);

beforeEach(resetDb);
afterAll(closeDb);

describe("saveCategory", () => {
  it("assigns sequential sort and derives the slug", async () => {
    const a = await cat("Hamburguesas");
    const b = await cat("Papas Fritas");
    expect((await categoryRow(a)).sort).toBe(0);
    expect((await categoryRow(b)).sort).toBe(1);
    expect((await categoryRow(b)).slug).toBe("papas-fritas");
  });

  it("maps duplicate name/slug to a field error without leaking SQL", async () => {
    await cat("Combos");
    const r = await saveCategory(db(), { name: "combos", active: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors?.name).toMatch(/Ya existe/);
      expect(JSON.stringify(r)).not.toMatch(/insert|violates|constraint/i);
    }
  });

  it("returns field errors for invalid input", async () => {
    const r = await saveCategory(db(), { name: "  ", active: true });
    expect(r).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
  });

  it("edits in place keeping sort", async () => {
    await cat("A");
    const b = await cat("B");
    const r = await saveCategory(db(), { id: b, name: "B2", active: false });
    expect(r).toEqual({ ok: true, data: { id: b } });
    const row = await categoryRow(b);
    expect(row).toMatchObject({ name: "B2", slug: "b2", active: false, sort: 1 });
  });

  it("reports a missing category on edit", async () => {
    const r = await saveCategory(db(), { id: 999, name: "X", active: true });
    expect(r.ok).toBe(false);
  });

  it("deletes the OLD image only after a successful replace, and on clear", async () => {
    const del = deleter();
    const id = await cat("Img", { imagePath: img(1) });
    await saveCategory(db(), { id, name: "Img", active: true, imagePath: img(2) }, { deleteImage: del });
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(img(1));
    await saveCategory(db(), { id, name: "Img", active: true, imagePath: null }, { deleteImage: del });
    expect(del).toHaveBeenLastCalledWith(img(2));
    expect(del).toHaveBeenCalledTimes(2);
  });

  it("does not delete anything when the image is unchanged or the update fails", async () => {
    const del = deleter();
    await cat("Otra");
    const id = await cat("Img", { imagePath: img(1) });
    await saveCategory(db(), { id, name: "Img", active: false, imagePath: img(1) }, { deleteImage: del });
    expect(del).not.toHaveBeenCalled();
    const r = await saveCategory(db(), { id, name: "Otra", active: true, imagePath: img(2) }, { deleteImage: del });
    expect(r.ok).toBe(false);
    expect(del).not.toHaveBeenCalled();
    expect((await categoryRow(id)).imagePath).toBe(img(1));
  });

  it("swallows deleteImage errors", async () => {
    const id = await cat("Img", { imagePath: img(1) });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const del = vi.fn(async () => {
      throw new Error("EPERM secret/path");
    });
    const r = await saveCategory(db(), { id, name: "Img", active: true, imagePath: null }, { deleteImage: del });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret/path");
    spy.mockRestore();
  });
});

describe("saveProduct", () => {
  it("stores whole pesos as cents and appends sort within the category", async () => {
    const c = await cat("Burgers");
    const a = await prod(c, "Doble", { priceArs: 14400 });
    const b = await prod(c, "Simple");
    expect((await productRow(a)).price).toBe(1_440_000);
    expect([(await productRow(a)).sort, (await productRow(b)).sort]).toEqual([0, 1]);
  });

  it("rejects duplicate names within a category but allows them across categories", async () => {
    const c1 = await cat("C1");
    const c2 = await cat("C2");
    await prod(c1, "Clásica");
    const dup = await saveProduct(db(), { categoryId: c1, name: "Clásica", priceArs: 1, active: true, featured: false });
    expect(dup).toMatchObject({ ok: false, fieldErrors: { name: expect.stringMatching(/Ya existe/) } });
    const other = await saveProduct(db(), { categoryId: c2, name: "Clásica", priceArs: 1, active: true, featured: false });
    expect(other.ok).toBe(true);
  });

  it("maps a missing category to a categoryId field error", async () => {
    const r = await saveProduct(db(), { categoryId: 4242, name: "X", priceArs: 1, active: true, featured: false });
    expect(r).toMatchObject({ ok: false, fieldErrors: { categoryId: expect.any(String) } });
    expect(JSON.stringify(r)).not.toMatch(/foreign key|violates/i);
  });

  it("validates price", async () => {
    const c = await cat("C");
    const r = await saveProduct(db(), { categoryId: c, name: "X", priceArs: -5, active: true, featured: false });
    expect(r).toMatchObject({ ok: false, fieldErrors: { priceArs: expect.any(String) } });
  });

  it("keeps sort on edit and appends when moving to another category", async () => {
    const c1 = await cat("C1");
    const c2 = await cat("C2");
    await prod(c1, "A");
    const b = await prod(c1, "B");
    await prod(c2, "X");
    await saveProduct(db(), { id: b, categoryId: c1, name: "B!", priceArs: 5, active: true, featured: true });
    expect(await productRow(b)).toMatchObject({ name: "B!", sort: 1, price: 500, featured: true });
    await saveProduct(db(), { id: b, categoryId: c2, name: "B!", priceArs: 5, active: true, featured: true });
    expect(await productRow(b)).toMatchObject({ categoryId: c2, sort: 1 });
  });

  it("replaces the image deleting the old one only after success", async () => {
    const del = deleter();
    const c = await cat("C");
    await prod(c, "Taken");
    const id = await prod(c, "P", { imagePath: img(1) });
    const base = { id, categoryId: c, priceArs: 1, active: true, featured: false };
    const failed = await saveProduct(db(), { ...base, name: "Taken", imagePath: img(2) }, { deleteImage: del });
    expect(failed.ok).toBe(false);
    expect(del).not.toHaveBeenCalled();
    await saveProduct(db(), { ...base, name: "P", imagePath: img(2) }, { deleteImage: del });
    expect(del).toHaveBeenCalledWith(img(1));
    await saveProduct(db(), { ...base, name: "P", imagePath: null }, { deleteImage: del });
    expect(del).toHaveBeenLastCalledWith(img(2));
    expect(del).toHaveBeenCalledTimes(2);
  });
});

describe("moveProduct / moveCategory", () => {
  it("swaps with the adjacent sibling and is a no-op at the ends", async () => {
    const c = await cat("C");
    const a = await prod(c, "A");
    const b = await prod(c, "B");
    const d = await prod(c, "D");
    await moveProduct(db(), d, "up");
    expect(await namesByOrder(c)).toEqual(["A", "D", "B"]);
    await moveProduct(db(), a, "up");
    expect(await namesByOrder(c)).toEqual(["A", "D", "B"]);
    await moveProduct(db(), b, "down");
    expect(await namesByOrder(c)).toEqual(["A", "D", "B"]);
    await moveProduct(db(), a, "down");
    expect(await namesByOrder(c)).toEqual(["D", "A", "B"]);
  });

  it("copes with gaps and duplicate sort values", async () => {
    const c = await cat("C");
    const ids = [await prod(c, "A"), await prod(c, "B"), await prod(c, "D"), await prod(c, "E")];
    const sorts = [5, 5, 5, 40];
    for (let i = 0; i < ids.length; i++) {
      await db().update(s.products).set({ sort: sorts[i] }).where(eq(s.products.id, ids[i]));
    }
    // ties break by id: A, B, D, E
    await moveProduct(db(), ids[1], "down");
    expect(await namesByOrder(c)).toEqual(["A", "D", "B", "E"]);
    const rows = await db().select().from(s.products).where(eq(s.products.categoryId, c)).orderBy(asc(s.products.sort));
    expect(rows.map((r) => r.sort)).toEqual([0, 1, 2, 3]);
  });

  it("only affects siblings in the same category", async () => {
    const c1 = await cat("C1");
    const c2 = await cat("C2");
    const a = await prod(c1, "A");
    await prod(c1, "B");
    const x = await prod(c2, "X");
    await prod(c2, "Y");
    await moveProduct(db(), a, "down");
    expect(await namesByOrder(c1)).toEqual(["B", "A"]);
    expect(await namesByOrder(c2)).toEqual(["X", "Y"]);
    expect((await productRow(x)).sort).toBe(0);
  });

  it("reorders categories the same way", async () => {
    const a = await cat("A");
    const b = await cat("B");
    await cat("C");
    await moveCategory(db(), b, "up");
    const order = async () =>
      (await db().select().from(s.categories).orderBy(asc(s.categories.sort))).map((c) => c.name);
    expect(await order()).toEqual(["B", "A", "C"]);
    await moveCategory(db(), b, "up");
    expect(await order()).toEqual(["B", "A", "C"]);
    await moveCategory(db(), a, "down");
    expect(await order()).toEqual(["B", "C", "A"]);
  });

  it("reports unknown ids", async () => {
    expect((await moveProduct(db(), 999, "up")).ok).toBe(false);
    expect((await moveCategory(db(), 999, "up")).ok).toBe(false);
  });
});

describe("suggest flag", () => {
  it("is saved on create and update, and left alone when the caller does not send it", async () => {
    const c = await cat("C");
    const p = await prod(c, "P", { suggest: true });
    expect(await productRow(p)).toMatchObject({ suggest: true });
    const base = { id: p, categoryId: c, name: "P", priceArs: 10, active: true, featured: false };
    await saveProduct(db(), base);
    expect(await productRow(p)).toMatchObject({ suggest: true });
    await saveProduct(db(), { ...base, suggest: false });
    expect(await productRow(p)).toMatchObject({ suggest: false });
  });
});

describe("toggles", () => {
  it("flips active and featured without hard deleting", async () => {
    const c = await cat("C");
    const p = await prod(c, "P");
    expect((await setProductActive(db(), p, false)).ok).toBe(true);
    expect((await setProductFeatured(db(), p, true)).ok).toBe(true);
    expect(await productRow(p)).toMatchObject({ active: false, featured: true });
    expect((await setCategoryActive(db(), c, false)).ok).toBe(true);
    expect((await categoryRow(c)).active).toBe(false);
    expect(await productRow(p)).toBeDefined();
  });

  it("reports unknown ids", async () => {
    expect((await setProductActive(db(), 999, true)).ok).toBe(false);
    expect((await setProductFeatured(db(), 999, true)).ok).toBe(false);
    expect((await setCategoryActive(db(), 999, true)).ok).toBe(false);
  });
});

describe("stock link on the product", () => {
  async function items() {
    const [coca, sprite, carne] = await db()
      .insert(s.stockItems)
      .values([
        { name: "Coca", kind: "bebida", unit: "u", quantity: 5000 },
        { name: "Sprite", kind: "bebida", unit: "u", quantity: 0 },
        { name: "Carne", kind: "materia_prima", unit: "kg", quantity: 5000 },
      ])
      .returning({ id: s.stockItems.id });
    return { coca: coca.id, sprite: sprite.id, carne: carne.id };
  }
  const save = (c: number, id: number | undefined, extra: Record<string, unknown>) =>
    saveProduct(db(), { id, categoryId: c, name: "Gaseosa", priceArs: 1000, active: true, featured: false, ...extra });

  it("linking to an empty drink pauses the product; linking to one with stock leaves it on sale; unlinking lifts the pause", async () => {
    const it = await items();
    const c = await cat("Bebidas");
    const p = await prod(c, "Gaseosa");
    expect((await save(c, p, { stockItemId: it.sprite })).ok).toBe(true);
    expect(await productRow(p)).toMatchObject({ stockItemId: it.sprite, stockPaused: true, active: true });
    expect((await save(c, p, { stockItemId: it.coca })).ok).toBe(true);
    expect(await productRow(p)).toMatchObject({ stockItemId: it.coca, stockPaused: false });
    expect((await save(c, p, { stockItemId: it.sprite })).ok).toBe(true);
    expect((await save(c, p, { stockItemId: null })).ok).toBe(true);
    expect(await productRow(p)).toMatchObject({ stockItemId: null, stockPaused: false });
  });

  it("leaves the link alone when the field is absent", async () => {
    const it = await items();
    const c = await cat("Bebidas");
    const p = await prod(c, "Gaseosa", { stockItemId: it.coca });
    expect((await save(c, p, {})).ok).toBe(true);
    expect((await productRow(p)).stockItemId).toBe(it.coca);
  });

  it("only drinks, only existing items, and one product per item", async () => {
    const it = await items();
    const c = await cat("Bebidas");
    const a = await prod(c, "A", { stockItemId: it.coca });
    const b = await prod(c, "B");
    expect(await save(c, b, { name: "B", stockItemId: it.carne })).toMatchObject({ ok: false, fieldErrors: { stockItemId: "Solo se pueden ligar artículos de tipo bebida" } });
    expect(await save(c, b, { name: "B", stockItemId: 9999 })).toMatchObject({ ok: false, fieldErrors: { stockItemId: "El artículo de stock no existe" } });
    expect(await save(c, b, { name: "B", stockItemId: it.coca })).toMatchObject({ ok: false, fieldErrors: { stockItemId: "Ese artículo ya está ligado a otro producto" } });
    expect((await productRow(a)).stockItemId).toBe(it.coca);
    expect((await productRow(b)).stockItemId).toBeNull();
  });

  it("refuses to reactivate a product paused by stock while its item is at zero", async () => {
    const it = await items();
    const c = await cat("Bebidas");
    const p = await prod(c, "Gaseosa", { stockItemId: it.sprite });
    expect((await productRow(p)).stockPaused).toBe(true);
    await setProductActive(db(), p, false);
    expect(await setProductActive(db(), p, true)).toEqual({ ok: false, error: "Sin stock: reponé primero" });
    expect(await save(c, p, { active: true, stockItemId: it.sprite })).toEqual({ ok: false, error: "Sin stock: reponé primero" });
    expect((await productRow(p)).active).toBe(false);
    await db().update(s.stockItems).set({ quantity: 3000 }).where(eq(s.stockItems.id, it.sprite));
    await db().update(s.products).set({ stockPaused: false }).where(eq(s.products.id, p));
    expect((await setProductActive(db(), p, true)).ok).toBe(true);
  });
});
