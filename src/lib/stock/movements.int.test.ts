import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { getEnv } from "@/lib/env";
import { STOCK_CHANNEL } from "@/lib/events/channels";
import { editMovement, registerIngreso, setInitialStock } from "./movements";
import { consume, itemQty, key, movementsOf, productFlags, seedStock, type StockFx } from "./test-fixtures";

const db = () => testDb();
const NOW = new Date("2026-10-19T15:00:00Z");
let fx: StockFx;

beforeEach(async () => {
  await resetDb();
  fx = await seedStock();
});

afterAll(async () => {
  await closeDb();
});

const ok = <T>(r: { ok: true; data: T } | { ok: false; code: string; message: string }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r.data;
};

describe("setInitialStock", () => {
  it("records an ajuste_inicial movement and sets the balance", async () => {
    ok(await setInitialStock(db(), { itemId: fx.carne, userId: fx.userId, milli: 60000 }, { now: NOW }));
    expect(await itemQty(fx.carne)).toBe(60000);
    const [m] = await movementsOf(fx.carne);
    expect(m).toMatchObject({ kind: "ajuste_inicial", qtyDelta: 60000, userId: fx.userId, businessDate: "2026-10-19" });
  });

  it("can be done only once per item", async () => {
    ok(await setInitialStock(db(), { itemId: fx.carne, userId: fx.userId, milli: 1000 }));
    const again = await setInitialStock(db(), { itemId: fx.carne, userId: fx.userId, milli: 2000 });
    expect(again).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await itemQty(fx.carne)).toBe(1000);
    expect(await movementsOf(fx.carne)).toHaveLength(1);
  });

  it("allows zero and rejects negatives or decimals on units", async () => {
    ok(await setInitialStock(db(), { itemId: fx.carne, userId: fx.userId, milli: 0 }));
    expect(await setInitialStock(db(), { itemId: fx.coca, userId: fx.userId, milli: -1000 })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await setInitialStock(db(), { itemId: fx.coca, userId: fx.userId, milli: 1500 })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await setInitialStock(db(), { itemId: 9999, userId: fx.userId, milli: 1000 })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("registerIngreso", () => {
  it("adds to the balance and records the movement with its note", async () => {
    ok(await setInitialStock(db(), { itemId: fx.coca, userId: fx.userId, milli: 10000 }));
    const r = ok(await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 48000, note: "Proveedor", idempotencyKey: key(1) }));
    expect(r).toEqual({ quantity: 58000 });
    expect(await itemQty(fx.coca)).toBe(58000);
    const ms = await movementsOf(fx.coca);
    expect(ms[1]).toMatchObject({ kind: "ingreso", qtyDelta: 48000, note: "Proveedor", userId: fx.userId });
  });

  it("the same idempotency key twice is ONE movement", async () => {
    const a = ok(await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 5000, idempotencyKey: key(2) }));
    const b = ok(await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 5000, idempotencyKey: key(2) }));
    expect(a).toEqual({ quantity: 5000 });
    expect(b).toEqual({ quantity: 5000 });
    expect(await movementsOf(fx.coca)).toHaveLength(1);
  });

  it("concurrent same-key submits still write one movement", async () => {
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 1000, idempotencyKey: key(3) })),
    );
    for (const r of rs) expect(r.ok).toBe(true);
    expect(await movementsOf(fx.coca)).toHaveLength(1);
    expect(await itemQty(fx.coca)).toBe(1000);
  });

  it("20 concurrent ingresos add up exactly", async () => {
    const rs = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        registerIngreso(db(), { itemId: fx.carne, userId: fx.userId, milli: 1500, idempotencyKey: key(100 + i) }),
      ),
    );
    for (const r of rs) expect(r.ok).toBe(true);
    expect(await itemQty(fx.carne)).toBe(30000);
    expect(await movementsOf(fx.carne)).toHaveLength(20);
  });

  it("rejects zero, decimals on units, bad keys, unknown and inactive items", async () => {
    expect(await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 0, idempotencyKey: key(4) })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 1500, idempotencyKey: key(4) })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 1000, idempotencyKey: "nope" })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await registerIngreso(db(), { itemId: 9999, userId: fx.userId, milli: 1000, idempotencyKey: key(5) })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    await db().update(s.stockItems).set({ active: false }).where(eq(s.stockItems.id, fx.carne));
    expect(await registerIngreso(db(), { itemId: fx.carne, userId: fx.userId, milli: 1000, idempotencyKey: key(6) })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await db().select().from(s.stockMovements)).toHaveLength(0);
  });

  it("restocking a drink paused by stock clears stock_paused but never touches a manual pause", async () => {
    await db().update(s.products).set({ stockPaused: true }).where(eq(s.products.id, fx.cocaProduct));
    ok(await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 2000, idempotencyKey: key(7) }));
    expect(await productFlags(fx.cocaProduct)).toEqual({ active: true, stockPaused: false });

    await db().update(s.products).set({ active: false }).where(eq(s.products.id, fx.cocaProduct));
    ok(await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 2000, idempotencyKey: key(8) }));
    expect(await productFlags(fx.cocaProduct)).toEqual({ active: false, stockPaused: false });
  });

  it("notifies the stock channel only after commit", async () => {
    const client = new Client({ connectionString: getEnv().DATABASE_URL });
    await client.connect();
    try {
      const got: string[] = [];
      client.on("notification", (m) => got.push(m.payload ?? ""));
      await client.query(`LISTEN ${STOCK_CHANNEL}`);
      ok(await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 1000, idempotencyKey: key(9) }));
      for (let i = 0; i < 50 && got.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
      expect(got.map((p) => JSON.parse(p))).toEqual([{ itemId: fx.coca, reason: "ingreso" }]);
    } finally {
      await client.end();
    }
  });
});

describe("consumo movements", () => {
  it("a drink consumed down to zero gets stock_paused", async () => {
    await consume(fx.coca, 10000);
    expect(await productFlags(fx.cocaProduct)).toEqual({ active: true, stockPaused: true });
    expect(await productFlags(fx.burger)).toEqual({ active: true, stockPaused: false });
  });
});

describe("editMovement", () => {
  it("stores the previous value, records who edited and recalculates the balance", async () => {
    ok(await setInitialStock(db(), { itemId: fx.carne, userId: fx.userId, milli: 60000 }));
    await consume(fx.carne, 50000);
    const [, consumo] = await movementsOf(fx.carne);
    const r = ok(await editMovement(db(), { movementId: consumo.id, userId: fx.userId, newMilli: 5000, confirmNegative: false }));
    expect(r).toEqual({ quantity: 55000 });
    const [, edited] = await movementsOf(fx.carne);
    expect(edited).toMatchObject({ qtyDelta: -5000, supersededValue: -50000, editedBy: fx.userId });
    expect(edited.editedAt).toBeInstanceOf(Date);
    expect(await itemQty(fx.carne)).toBe(55000);
  });

  it("two consecutive edits keep both previous values, authors and timestamps in order", async () => {
    const [other] = await db()
      .insert(s.users)
      .values({ name: "Admin", username: "admin2", passwordHash: "x", role: "admin" })
      .returning({ id: s.users.id });
    ok(await registerIngreso(db(), { itemId: fx.carne, userId: fx.userId, milli: 10000, idempotencyKey: key(60) }));
    const [m] = await movementsOf(fx.carne);
    const t1 = new Date("2026-10-19T16:00:00Z");
    const t2 = new Date("2026-10-19T17:00:00Z");
    ok(await editMovement(db(), { movementId: m.id, userId: fx.userId, newMilli: 8000, confirmNegative: false }, { now: t1 }));
    ok(await editMovement(db(), { movementId: m.id, userId: other.id, newMilli: 9500, confirmNegative: false }, { now: t2 }));
    // a no-op edit is not recorded
    ok(await editMovement(db(), { movementId: m.id, userId: other.id, newMilli: 9500, confirmNegative: false }));

    const edits = await db().select().from(s.stockMovementEdits).where(eq(s.stockMovementEdits.movementId, m.id)).orderBy(s.stockMovementEdits.id);
    expect(edits.map((e) => [e.previousDelta, e.newDelta, e.editedBy, e.editedAt.toISOString()])).toEqual([
      [10000, 8000, fx.userId, t1.toISOString()],
      [8000, 9500, other.id, t2.toISOString()],
    ]);
    const [latest] = await movementsOf(fx.carne);
    expect(latest).toMatchObject({ qtyDelta: 9500, supersededValue: 8000, editedBy: other.id });
    expect(await itemQty(fx.carne)).toBe(9500);
  });

  it("an edit that needs confirmation records no edit row", async () => {
    ok(await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 3000, idempotencyKey: key(61) }));
    await consume(fx.coca, 3000);
    const [ing] = await movementsOf(fx.coca);
    const r = ok(await editMovement(db(), { movementId: ing.id, userId: fx.userId, newMilli: 1000, confirmNegative: false }));
    expect(r.needsConfirmation).toEqual({ resultingQuantity: -2000 });
    expect(await db().select().from(s.stockMovementEdits)).toHaveLength(0);
  });

  it("editing to the same value is a no-op", async () => {
    ok(await registerIngreso(db(), { itemId: fx.carne, userId: fx.userId, milli: 3000, idempotencyKey: key(51) }));
    const [m] = await movementsOf(fx.carne);
    ok(await editMovement(db(), { movementId: m.id, userId: fx.userId, newMilli: 3000, confirmNegative: false }));
    const [after] = await movementsOf(fx.carne);
    expect(after.supersededValue).toBeNull();
  });

  it("would-be negative balance without confirmation returns needsConfirmation and changes nothing", async () => {
    ok(await setInitialStock(db(), { itemId: fx.coca, userId: fx.userId, milli: 2000 }));
    ok(await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 24000, idempotencyKey: key(52) }));
    await consume(fx.coca, 20000);
    const ingreso = (await movementsOf(fx.coca))[1];
    const r = ok(await editMovement(db(), { movementId: ingreso.id, userId: fx.userId, newMilli: 12000, confirmNegative: false }));
    expect(r).toEqual({ quantity: 6000, needsConfirmation: { resultingQuantity: -6000 } });
    expect(await itemQty(fx.coca)).toBe(6000);
    expect((await movementsOf(fx.coca))[1]).toMatchObject({ qtyDelta: 24000, supersededValue: null });
    expect(await productFlags(fx.cocaProduct)).toEqual({ active: true, stockPaused: false });

    const c = ok(await editMovement(db(), { movementId: ingreso.id, userId: fx.userId, newMilli: 12000, confirmNegative: true }));
    expect(c).toEqual({ quantity: -6000 });
    expect((await movementsOf(fx.coca))[1]).toMatchObject({ qtyDelta: 12000, supersededValue: 24000 });
    expect(await productFlags(fx.cocaProduct)).toEqual({ active: true, stockPaused: true });
  });

  it("refuses to edit sales and returns, and validates input", async () => {
    const [order] = await db()
      .insert(s.orders)
      .values({
        businessDate: "2026-10-19",
        number: 1,
        publicToken: "tok-1",
        channel: "web",
        fulfillment: "takeaway",
        status: "pendiente_aprobacion",
        paymentMethod: "cash",
        customerName: "Ana",
        subtotal: 100,
        total: 100,
      })
      .returning({ id: s.orders.id });
    const [venta] = await db()
      .insert(s.stockMovements)
      .values({ itemId: fx.coca, kind: "venta", qtyDelta: -1000, businessDate: "2026-10-19", orderId: order.id })
      .returning({ id: s.stockMovements.id });
    expect(await editMovement(db(), { movementId: venta.id, userId: fx.userId, newMilli: 2000, confirmNegative: true })).toMatchObject({ ok: false, code: "NOT_EDITABLE" });
    expect(await editMovement(db(), { movementId: 9999, userId: fx.userId, newMilli: 2000, confirmNegative: true })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    ok(await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 3000, idempotencyKey: key(54) }));
    const ing = (await movementsOf(fx.coca))[1];
    expect(await editMovement(db(), { movementId: ing.id, userId: fx.userId, newMilli: 1500, confirmNegative: true })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await editMovement(db(), { movementId: ing.id, userId: fx.userId, newMilli: -1, confirmNegative: true })).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("one venta and one devolucion per order and item (unique partial index)", async () => {
    const [order] = await db()
      .insert(s.orders)
      .values({
        businessDate: "2026-10-19",
        number: 2,
        publicToken: "tok-2",
        channel: "web",
        fulfillment: "takeaway",
        status: "pendiente_aprobacion",
        paymentMethod: "cash",
        customerName: "Ana",
        subtotal: 100,
        total: 100,
      })
      .returning({ id: s.orders.id });
    const row = { itemId: fx.coca, kind: "venta" as const, qtyDelta: -1000, businessDate: "2026-10-19", orderId: order.id };
    await db().insert(s.stockMovements).values(row);
    await expect(db().insert(s.stockMovements).values(row)).rejects.toThrow();
    await db().insert(s.stockMovements).values({ ...row, kind: "devolucion", qtyDelta: 1000 });
  });
});

describe("balance range (int4) and idempotency payload", () => {
  const MAX = 1_000_000_000;

  it("rejects an ingreso that would push the balance past int4, with an es-AR message and no write", async () => {
    ok(await registerIngreso(db(), { itemId: fx.carne, userId: fx.userId, milli: MAX, idempotencyKey: key(90) }));
    ok(await registerIngreso(db(), { itemId: fx.carne, userId: fx.userId, milli: MAX, idempotencyKey: key(91) }));
    const r = await registerIngreso(db(), { itemId: fx.carne, userId: fx.userId, milli: MAX, idempotencyKey: key(92) });
    expect(r).toMatchObject({ ok: false, code: "VALIDATION", message: "El saldo superaría el máximo permitido. Revisá la cantidad." });
    expect(await itemQty(fx.carne)).toBe(2 * MAX);
    expect(await movementsOf(fx.carne)).toHaveLength(2);
  });

  it("rejects an edit that would push the balance past int4", async () => {
    ok(await registerIngreso(db(), { itemId: fx.carne, userId: fx.userId, milli: MAX, idempotencyKey: key(96) }));
    await consume(fx.carne, MAX);
    ok(await registerIngreso(db(), { itemId: fx.carne, userId: fx.userId, milli: MAX, idempotencyKey: key(98) }));
    ok(await registerIngreso(db(), { itemId: fx.carne, userId: fx.userId, milli: MAX, idempotencyKey: key(99) }));
    ok(await registerIngreso(db(), { itemId: fx.carne, userId: fx.userId, milli: 100_000_000, idempotencyKey: key(100) }));
    const consumoRow = (await movementsOf(fx.carne)).find((m) => m.kind === "consumo")!;
    const r = await editMovement(db(), { movementId: consumoRow.id, userId: fx.userId, newMilli: 0, confirmNegative: true });
    expect(r).toMatchObject({ ok: false, code: "VALIDATION", message: "El saldo superaría el máximo permitido. Revisá la cantidad." });
    expect(await itemQty(fx.carne)).toBe(2_100_000_000);
  });

  it("an ingreso key reused with a different payload is rejected; the same payload returns the first result", async () => {
    ok(await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 5000, note: "Proveedor", idempotencyKey: key(98) }));
    const same = await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 5000, note: "Proveedor", idempotencyKey: key(98) });
    expect(same).toEqual({ ok: true, data: { quantity: 5000 } });
    for (const other of [
      { itemId: fx.coca, milli: 6000, note: "Proveedor" },
      { itemId: fx.carne, milli: 5000, note: "Proveedor" },
      { itemId: fx.coca, milli: 5000, note: "Otro" },
    ]) {
      const r = await registerIngreso(db(), { userId: fx.userId, idempotencyKey: key(98), ...other });
      expect(r).toMatchObject({ ok: false, code: "CONFLICT" });
    }
    expect(await movementsOf(fx.coca)).toHaveLength(1);
    expect(await itemQty(fx.coca)).toBe(5000);
  });

});
