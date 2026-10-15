import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { resetDb, testDb } from "@/db/test-utils";
import { moveCategory, saveCategory, saveProduct } from "./admin";
import { getCategoryForAdmin, getProductForAdmin, listMenuForAdmin } from "./admin-queries";

beforeEach(resetDb);
afterAll(closeDb);

describe("admin queries", () => {
  it("lists categories in sort order with their products, including inactive ones", async () => {
    const db = testDb();
    const a = await saveCategory(db, { name: "A", active: true });
    const b = await saveCategory(db, { name: "B", active: false });
    if (!a.ok || !b.ok) throw new Error("seed");
    await saveProduct(db, { categoryId: a.data.id, name: "P1", priceArs: 1, active: false, featured: false });
    await saveProduct(db, { categoryId: a.data.id, name: "P2", priceArs: 1, active: true, featured: false });
    await moveCategory(db, b.data.id, "up");
    const menu = await listMenuForAdmin(db);
    expect(menu.map((c) => c.name)).toEqual(["B", "A"]);
    expect(menu[1].products.map((p) => p.name)).toEqual(["P1", "P2"]);
    expect(menu[0].products).toEqual([]);
  });

  it("returns null for unknown ids", async () => {
    expect(await getCategoryForAdmin(testDb(), 99)).toBeNull();
    expect(await getProductForAdmin(testDb(), 99)).toBeNull();
  });
});
