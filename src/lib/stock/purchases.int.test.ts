import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { editMovement, registerIngreso } from "./movements";
import { listPurchases, listUnpricedIngresos } from "./purchases";
import { key, movementsOf, seedStock, type StockFx } from "./test-fixtures";

const db = () => testDb();
let fx: StockFx;
let n = 900;

beforeEach(async () => {
  await resetDb();
  fx = await seedStock();
});

afterAll(async () => {
  await closeDb();
});

/** One ingreso on a given business date (the ledger date is rewritten so the order is explicit). */
async function buy(itemId: number, milli: number, unitPrice: number | null, businessDate: string): Promise<number> {
  const r = await registerIngreso(db(), { itemId, userId: fx.userId, milli, idempotencyKey: key(n++), unitPrice });
  if (!r.ok) throw new Error(r.message);
  const ms = await movementsOf(itemId);
  const id = ms[ms.length - 1].id;
  await db().update(s.stockMovements).set({ businessDate }).where(eq(s.stockMovements.id, id));
  return id;
}

describe("listPurchases", () => {
  it("lists priced ingresos per item with the change against the previous one", async () => {
    await buy(fx.carne, 15_000, 200_000, "2026-10-21");
    await buy(fx.carne, 10_000, null, "2026-10-25");
    await buy(fx.carne, 20_000, 240_000, "2026-11-04");
    await buy(fx.coca, 40_000, 150_000, "2026-11-01");

    const groups = await listPurchases(db());
    expect(groups.map((g) => g.itemId)).toEqual([fx.carne, fx.coca]);
    const carne = groups[0];
    expect(carne.purchases).toHaveLength(2);
    expect(carne.last).toMatchObject({ unitPrice: 240_000, milli: 20_000, total: 4_800_000, changePct: 20, businessDate: "2026-11-04" });
    expect(carne.purchases[1]).toMatchObject({ unitPrice: 200_000, changePct: null });
    expect(groups[1].last).toMatchObject({ total: 6_000_000, changePct: null });
  });

  it("an annulled purchase disappears and the next compares with the one before", async () => {
    await buy(fx.carne, 10_000, 200_000, "2026-10-01");
    const middle = await buy(fx.carne, 10_000, 100_000, "2026-10-10");
    await buy(fx.carne, 10_000, 240_000, "2026-10-20");
    const r = await editMovement(db(), { movementId: middle, userId: fx.userId, newMilli: 0, confirmNegative: true });
    expect(r.ok).toBe(true);

    const [carne] = await listPurchases(db());
    expect(carne.purchases.map((p) => p.unitPrice)).toEqual([240_000, 200_000]);
    expect(carne.last.changePct).toBe(20);
  });

  it("the total follows a corrected quantity", async () => {
    const id = await buy(fx.carne, 20_000, 200_000, "2026-10-01");
    expect((await editMovement(db(), { movementId: id, userId: fx.userId, newMilli: 10_000, confirmNegative: true })).ok).toBe(true);
    const [carne] = await listPurchases(db());
    expect(carne.last.total).toBe(2_000_000);
  });

  it("filters by item, and lists the unpriced ingresos of an item", async () => {
    await buy(fx.carne, 10_000, 200_000, "2026-10-01");
    const unpriced = await buy(fx.carne, 5_000, null, "2026-10-02");
    await buy(fx.coca, 40_000, 150_000, "2026-10-03");

    const only = await listPurchases(db(), { itemId: fx.coca });
    expect(only.map((g) => g.itemId)).toEqual([fx.coca]);
    const list = await listUnpricedIngresos(db(), fx.carne);
    expect(list.map((m) => m.movementId)).toEqual([unpriced]);
    expect(list[0]).toMatchObject({ milli: 5_000, businessDate: "2026-10-02" });
  });

  it("keeps the real previous price for the oldest row shown", async () => {
    await buy(fx.carne, 1_000, 100_000, "2026-10-01");
    await buy(fx.carne, 1_000, 110_000, "2026-10-02");
    await buy(fx.carne, 1_000, 121_000, "2026-10-03");
    const [carne] = await listPurchases(db(), { perItem: 2 });
    expect(carne.purchases.map((p) => p.changePct)).toEqual([10, 10]);
  });
});
