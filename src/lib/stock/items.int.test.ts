import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { createStockItem, updateStockItem } from "./items";
import { setInitialStock } from "./movements";
import { productFlags, seedStock, type StockFx } from "./test-fixtures";

const db = () => testDb();
let fx: StockFx;

beforeEach(async () => {
  await resetDb();
  fx = await seedStock();
});

afterAll(async () => {
  await closeDb();
});

describe("createStockItem", () => {
  it("creates an active item with zero balance", async () => {
    const r = await createStockItem(db(), { name: "  Pan de hamburguesa ", kind: "materia_prima", unit: "u", minQty: 24000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [row] = await db().select().from(s.stockItems).where(eq(s.stockItems.id, r.data.id));
    expect(row).toMatchObject({ name: "Pan de hamburguesa", kind: "materia_prima", unit: "u", minQty: 24000, quantity: 0, active: true });
  });

  it("rejects duplicate names (case-insensitive), bad kinds/units and fractional unit minimums", async () => {
    expect(await createStockItem(db(), { name: "carne PICADA", kind: "materia_prima", unit: "kg", minQty: 0 })).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await createStockItem(db(), { name: "Hielo", kind: "otro", unit: "kg", minQty: 0 })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await createStockItem(db(), { name: "Hielo", kind: "materia_prima", unit: "g", minQty: 0 })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await createStockItem(db(), { name: "Hielo", kind: "materia_prima", unit: "u", minQty: 1500 })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await createStockItem(db(), { name: "H", kind: "materia_prima", unit: "kg", minQty: 0 })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await createStockItem(db(), { name: "Hielo", kind: "materia_prima", unit: "kg", minQty: -1 })).toMatchObject({ ok: false, code: "VALIDATION" });
  });
});

describe("updateStockItem", () => {
  it("renames and changes the minimum", async () => {
    const r = await updateStockItem(db(), { itemId: fx.carne, name: "Carne picada especial", minQty: 5000, active: true });
    expect(r.ok).toBe(true);
    const [row] = await db().select().from(s.stockItems).where(eq(s.stockItems.id, fx.carne));
    expect(row).toMatchObject({ name: "Carne picada especial", minQty: 5000 });
    expect(await updateStockItem(db(), { itemId: fx.carne, name: "Coca-Cola 500 ml", minQty: 0, active: true })).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await updateStockItem(db(), { itemId: 9999, name: "X x", minQty: 0, active: true })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("deactivating a drink lifts its stock pause; reactivating with zero stock pauses again", async () => {
    await setInitialStock(db(), { itemId: fx.coca, userId: fx.userId, milli: 0 });
    expect((await productFlags(fx.cocaProduct)).stockPaused).toBe(true);
    await updateStockItem(db(), { itemId: fx.coca, name: "Coca-Cola 500 ml", minQty: 6000, active: false });
    expect(await productFlags(fx.cocaProduct)).toEqual({ active: true, stockPaused: false });
    await updateStockItem(db(), { itemId: fx.coca, name: "Coca-Cola 500 ml", minQty: 6000, active: true });
    expect(await productFlags(fx.cocaProduct)).toEqual({ active: true, stockPaused: true });
  });
});
