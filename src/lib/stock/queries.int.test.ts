import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { editMovement, registerConsumo, registerIngreso, setInitialStock } from "./movements";
import { listMovements, listShortages, listStockItems } from "./queries";
import { key, movementsOf, seedStock, type StockFx } from "./test-fixtures";

const db = () => testDb();
let fx: StockFx;

beforeEach(async () => {
  await resetDb();
  fx = await seedStock();
});

afterAll(async () => {
  await closeDb();
});

async function backdate(itemId: number, isoTimes: string[]): Promise<void> {
  const ms = await movementsOf(itemId);
  for (const [i, m] of ms.entries()) {
    await db().update(s.stockMovements).set({ createdAt: new Date(isoTimes[i]) }).where(eq(s.stockMovements.id, m.id));
  }
}

describe("listStockItems", () => {
  it("lists every item with its status, drinks first then by name", async () => {
    await setInitialStock(db(), { itemId: fx.coca, userId: fx.userId, milli: 3000 });
    await setInitialStock(db(), { itemId: fx.carne, userId: fx.userId, milli: 20000 });
    const items = await listStockItems(db());
    expect(items.map((i) => [i.name, i.status, i.quantity])).toEqual([
      ["Coca-Cola 500 ml", "poco", 3000],
      ["Carne picada", "ok", 20000],
    ]);
    expect(items[0]).toMatchObject({ kind: "bebida", unit: "u", minQty: 6000, active: true, linkedProducts: 1 });
  });
});

describe("listMovements", () => {
  it("returns newest first with item, unit, author and the superseded value", async () => {
    await setInitialStock(db(), { itemId: fx.carne, userId: fx.userId, milli: 20000 });
    await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 6000, note: "Factura 12", idempotencyKey: key(1) });
    const [ing] = await movementsOf(fx.coca);
    await editMovement(db(), { movementId: ing.id, userId: fx.userId, newMilli: 12000, confirmNegative: false });
    const all = await listMovements(db(), {});
    expect(all.map((m) => m.kind)).toEqual(["ingreso", "ajuste_inicial"]);
    expect(all[0]).toMatchObject({
      itemName: "Coca-Cola 500 ml",
      unit: "u",
      qtyDelta: 12000,
      supersededValue: 6000,
      userName: "Enzo",
      editedByName: "Enzo",
      note: "Factura 12",
    });
    await editMovement(db(), { movementId: ing.id, userId: fx.userId, newMilli: 9000, confirmNegative: false });
    const [twice] = await listMovements(db(), { itemId: fx.coca });
    expect(twice.edits.map((e) => [e.previousDelta, e.newDelta, e.editedByName])).toEqual([
      [6000, 12000, "Enzo"],
      [12000, 9000, "Enzo"],
    ]);
    expect(twice.edits[0].editedAt).toBeInstanceOf(Date);
    const [initial] = await listMovements(db(), { itemId: fx.carne });
    expect(initial.edits).toEqual([]);
    expect(await listMovements(db(), { itemId: fx.carne })).toHaveLength(1);
    expect(await listMovements(db(), { limit: 1 })).toHaveLength(1);
  });
});

describe("listShortages", () => {
  it("lists active items that are out (agotado) or below the minimum (bajo_minimo), with since", async () => {
    await setInitialStock(db(), { itemId: fx.coca, userId: fx.userId, milli: 2000 });
    await registerConsumo(db(), { userId: fx.userId, businessDate: "2026-10-19", lines: [{ itemId: fx.coca, milli: 2000 }], idempotencyKey: key(2) });
    await backdate(fx.coca, ["2026-10-18T10:00:00Z", "2026-10-19T12:00:00Z"]);

    await setInitialStock(db(), { itemId: fx.carne, userId: fx.userId, milli: 30000 });
    await registerConsumo(db(), { userId: fx.userId, businessDate: "2026-10-19", lines: [{ itemId: fx.carne, milli: 15000 }], idempotencyKey: key(3) });
    await registerConsumo(db(), { userId: fx.userId, businessDate: "2026-10-19", lines: [{ itemId: fx.carne, milli: 10000 }], idempotencyKey: key(4) });
    await registerConsumo(db(), { userId: fx.userId, businessDate: "2026-10-19", lines: [{ itemId: fx.carne, milli: 1000 }], idempotencyKey: key(5) });
    await backdate(fx.carne, ["2026-10-17T10:00:00Z", "2026-10-18T10:00:00Z", "2026-10-19T09:00:00Z", "2026-10-19T11:00:00Z"]);

    const list = await listShortages(db());
    expect(list).toEqual([
      { itemId: fx.coca, name: "Coca-Cola 500 ml", kind: "bebida", quantity: 0, unit: "u", minQty: 6000, since: new Date("2026-10-19T12:00:00Z"), reason: "agotado" },
      { itemId: fx.carne, name: "Carne picada", kind: "materia_prima", quantity: 4000, unit: "kg", minQty: 10000, since: new Date("2026-10-19T09:00:00Z"), reason: "bajo_minimo" },
    ]);
  });

  it("an item that never had stock is agotado since its first movement, or null without movements", async () => {
    await setInitialStock(db(), { itemId: fx.coca, userId: fx.userId, milli: 0 });
    await backdate(fx.coca, ["2026-10-15T10:00:00Z"]);
    const list = await listShortages(db());
    expect(list.find((x) => x.itemId === fx.coca)).toMatchObject({ reason: "agotado", since: new Date("2026-10-15T10:00:00Z") });
    expect(list.find((x) => x.itemId === fx.carne)).toMatchObject({ reason: "agotado", since: null });
  });

  it("restocked and inactive items are not shortages", async () => {
    await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 6000, idempotencyKey: key(6) });
    await db().update(s.stockItems).set({ active: false }).where(eq(s.stockItems.id, fx.carne));
    expect(await listShortages(db())).toEqual([]);
  });
});
