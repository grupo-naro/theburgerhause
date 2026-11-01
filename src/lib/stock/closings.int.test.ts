import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { closeStockDay, lastClosedDate, listClosedDates, listClosings } from "./closings";
import { editMovement, setInitialStock } from "./movements";
import { listMovements } from "./queries";
import { itemQty, key, movementsOf, seedStock, type StockFx } from "./test-fixtures";

const db = () => testDb();
/** Saturday 31/10/2026 11:00 in Buenos Aires. */
const NOW = new Date("2026-10-31T14:00:00Z");
const ctx = { now: NOW };
let fx: StockFx;
let pan: number;

beforeEach(async () => {
  await resetDb();
  fx = await seedStock();
  const [p] = await db().insert(s.stockItems).values({ name: "Pan de papa", kind: "materia_prima", unit: "u" }).returning({ id: s.stockItems.id });
  pan = p.id;
  ok(await setInitialStock(db(), { itemId: fx.carne, userId: fx.userId, milli: 60000 }));
  ok(await setInitialStock(db(), { itemId: pan, userId: fx.userId, milli: 100000 }));
});

afterAll(async () => {
  await closeDb();
});

const ok = <T>(r: { ok: true; data: T } | { ok: false; code: string; message: string }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r.data;
};

const close = (businessDate: string, lines: { itemId: number; milli: number }[], n: number, extra: { confirmNegative?: boolean; userId?: number } = {}) =>
  closeStockDay(db(), { userId: extra.userId ?? fx.userId, businessDate, lines, idempotencyKey: key(n), confirmNegative: extra.confirmNegative }, ctx);

/** quantity = sum(qty_delta) for every item. */
async function expectLedgerConsistent(): Promise<void> {
  const rows = await db().execute<{ id: number; quantity: number; total: number }>(
    sql`select i.id, i.quantity, coalesce(sum(m.qty_delta), 0)::int as total from stock_items i left join stock_movements m on m.item_id = i.id group by i.id`,
  );
  for (const r of rows.rows) expect(Number(r.quantity), `item ${r.id}`).toBe(Number(r.total));
}

describe("closeStockDay", () => {
  it("writes one consumo per non-empty line, dated to the closed day, together with the closing row", async () => {
    const data = ok(
      await close("2026-10-30", [
        { itemId: fx.carne, milli: 12500 },
        { itemId: pan, milli: 0 },
      ], 1),
    );
    const [closing] = await db().select().from(s.stockClosings);
    expect(closing).toMatchObject({ id: data.closingId, businessDate: "2026-10-30", closedBy: fx.userId, closedAt: NOW, idempotencyKey: `cierre:${key(1)}` });
    expect(data).toEqual({ closingId: closing.id, businessDate: "2026-10-30" });
    const [, consumo] = await movementsOf(fx.carne);
    expect(consumo).toMatchObject({ kind: "consumo", qtyDelta: -12500, businessDate: "2026-10-30", userId: fx.userId, closingId: closing.id });
    expect(await movementsOf(pan)).toHaveLength(1); // the blank line wrote nothing
    expect(await itemQty(fx.carne)).toBe(47500);
    await expectLedgerConsistent();
  });

  it("requires at least one quantity and refuses bad dates, drinks, inactive or unknown items and decimals on units, writing nothing", async () => {
    await db().update(s.stockItems).set({ active: false }).where(eq(s.stockItems.name, "Coca-Cola 500 ml"));
    const [queso] = await db().insert(s.stockItems).values({ name: "Queso", kind: "materia_prima", unit: "kg", active: false }).returning({ id: s.stockItems.id });
    const cases: [string, { itemId: number; milli: number }[], string][] = [
      ["2026-10-30", [], "Cargá al menos una cantidad"],
      ["2026-10-30", [{ itemId: fx.carne, milli: 0 }], "Cargá al menos una cantidad"],
      ["2026-10-30", [{ itemId: fx.carne, milli: 1000 }, { itemId: fx.carne, milli: 1000 }], "Hay un artículo repetido"],
      ["2026-10-30", [{ itemId: fx.carne, milli: 1000 }, { itemId: fx.coca, milli: 1000 }], "El artículo está dado de baja: Coca-Cola 500 ml"],
      ["2026-10-30", [{ itemId: fx.carne, milli: 1000 }, { itemId: queso.id, milli: 1000 }], "El artículo está dado de baja: Queso"],
      ["2026-10-30", [{ itemId: fx.carne, milli: 1000 }, { itemId: 9999, milli: 1000 }], "El artículo no existe"],
      ["2026-10-30", [{ itemId: fx.carne, milli: 1000 }, { itemId: pan, milli: 1500 }], "Para unidades usá números enteros: Pan de papa"],
      ["2026-11-01", [{ itemId: fx.carne, milli: 1000 }], "Ese día todavía no llegó: elegí hoy o un día anterior."],
      ["2026-13-01", [{ itemId: fx.carne, milli: 1000 }], "Fecha inválida"],
    ];
    for (const [i, [date, lines, message]] of cases.entries()) {
      expect(await close(date, lines, 10 + i), `${date} ${JSON.stringify(lines)}`).toMatchObject({ ok: false, message });
    }
    await db().update(s.stockItems).set({ active: true }).where(eq(s.stockItems.id, fx.coca));
    expect(await close("2026-10-30", [{ itemId: fx.coca, milli: 1000 }], 30, { confirmNegative: true })).toMatchObject({
      ok: false,
      message: "Solo se rinde materia prima: Coca-Cola 500 ml",
    });
    expect(await db().select().from(s.stockClosings)).toHaveLength(0);
    expect(await db().select().from(s.stockMovements)).toHaveLength(2); // the two initial stocks
    expect(await itemQty(fx.carne)).toBe(60000);
  });

  it("today (Buenos Aires) can be closed even when it is already tomorrow in UTC", async () => {
    // 22:30 on Saturday 31/10 in Buenos Aires = 01:30 on Sunday in UTC.
    const late = { now: new Date("2026-11-01T01:30:00Z") };
    ok(await closeStockDay(db(), { userId: fx.userId, businessDate: "2026-10-31", lines: [{ itemId: fx.carne, milli: 1000 }], idempotencyKey: key(1) }, late));
    expect(
      await closeStockDay(db(), { userId: fx.userId, businessDate: "2026-11-01", lines: [{ itemId: fx.carne, milli: 1000 }], idempotencyKey: key(2) }, late),
    ).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("closes a date ONCE: another closing of that date is refused and writes nothing", async () => {
    ok(await close("2026-10-30", [{ itemId: fx.carne, milli: 1000 }], 1));
    const again = await close("2026-10-30", [{ itemId: pan, milli: 2000 }], 2);
    expect(again).toMatchObject({
      ok: false,
      code: "CONFLICT",
      message: "La rendición de ese día ya está cerrada. Para corregirla usá el Historial.",
      fieldErrors: { businessDate: "La rendición de ese día ya está cerrada. Para corregirla usá el Historial." },
    });
    expect(await movementsOf(pan)).toHaveLength(1);
    // Another date is fine.
    ok(await close("2026-10-29", [{ itemId: pan, milli: 2000 }], 3));
    expect(await db().select().from(s.stockClosings)).toHaveLength(2);
    await expectLedgerConsistent();
  });

  it("concurrent closings of the same date from two devices: exactly one wins", async () => {
    const rs = await Promise.all([1, 2, 3, 4].map((n) => close("2026-10-30", [{ itemId: fx.carne, milli: 1000 }], n)));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok && r.code === "CONFLICT")).toHaveLength(3);
    expect(await db().select().from(s.stockClosings)).toHaveLength(1);
    expect(await movementsOf(fx.carne)).toHaveLength(2);
    expect(await itemQty(fx.carne)).toBe(59000);
    await expectLedgerConsistent();
  });

  it("the same key again (a double tap, a retry) returns the first result without applying it twice", async () => {
    const lines = [
      { itemId: fx.carne, milli: 1000 },
      { itemId: pan, milli: 2000 },
    ];
    const rs = await Promise.all([close("2026-10-30", lines, 1), close("2026-10-30", lines, 1)]);
    const [a, b] = rs.map(ok);
    expect(a).toEqual(b);
    expect(ok(await close("2026-10-30", lines, 1))).toEqual(a);
    expect(await itemQty(fx.carne)).toBe(59000);
    expect(await itemQty(pan)).toBe(98000);
    expect(await movementsOf(fx.carne)).toHaveLength(2);
    // The key on another date is a reused key, not a resubmit.
    expect(await close("2026-10-29", lines, 1)).toMatchObject({ ok: false, code: "CONFLICT", message: expect.stringContaining("otros datos") });
    await expectLedgerConsistent();
  });

  it("asks to confirm before leaving stock negative (listing the items), then 'Guardar igual' closes it", async () => {
    const lines = [
      { itemId: fx.carne, milli: 70000 },
      { itemId: pan, milli: 1000 },
    ];
    const r = await close("2026-10-30", lines, 1);
    expect(r).toMatchObject({ ok: false, code: "NEEDS_CONFIRMATION", negatives: [{ itemId: fx.carne, name: "Carne picada", resultingQuantity: -10000 }] });
    expect(await db().select().from(s.stockClosings)).toHaveLength(0);
    expect(await itemQty(fx.carne)).toBe(60000);
    ok(await close("2026-10-30", lines, 1, { confirmNegative: true }));
    expect(await itemQty(fx.carne)).toBe(-10000);
    expect(await itemQty(pan)).toBe(99000);
    await expectLedgerConsistent();
  });

  it("closings listing overlapping items in opposite order on different days do not deadlock and sum exactly", async () => {
    const rounds = 10;
    const rs = await Promise.all(
      Array.from({ length: rounds }, (_, i) =>
        close(
          `2026-10-${String(10 + i).padStart(2, "0")}`,
          i % 2 === 0
            ? [
                { itemId: fx.carne, milli: 1000 },
                { itemId: pan, milli: 1000 },
              ]
            : [
                { itemId: pan, milli: 1000 },
                { itemId: fx.carne, milli: 1000 },
              ],
          100 + i,
        ),
      ),
    );
    for (const r of rs) expect(r.ok).toBe(true);
    expect(await itemQty(fx.carne)).toBe(60000 - rounds * 1000);
    expect(await itemQty(pan)).toBe(100000 - rounds * 1000);
    await expectLedgerConsistent();
  });

  it("rejects a closing that would push the balance below int4", async () => {
    const MAX = 1_000_000_000;
    ok(await close("2026-10-01", [{ itemId: fx.carne, milli: MAX }], 1, { confirmNegative: true }));
    ok(await close("2026-10-02", [{ itemId: fx.carne, milli: MAX }], 2, { confirmNegative: true }));
    expect(await close("2026-10-03", [{ itemId: fx.carne, milli: MAX }], 3, { confirmNegative: true })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await db().select().from(s.stockClosings)).toHaveLength(2);
  });
});

describe("reading the rendiciones", () => {
  it("shows the CURRENT amounts: a correction from the history is what the closing shows; a line corrected to zero disappears", async () => {
    const [admin] = await db().insert(s.users).values({ name: "Ana", username: "ana", passwordHash: "x", role: "admin" }).returning({ id: s.users.id });
    ok(
      await close("2026-10-30", [
        { itemId: fx.carne, milli: 12500 },
        { itemId: pan, milli: 40000 },
      ], 1),
    );
    const [view] = await listClosings(db(), { date: "2026-10-30" });
    expect(view).toMatchObject({ businessDate: "2026-10-30", closedByName: "Enzo", closedAt: NOW });
    expect(view.lines).toEqual([
      { itemId: fx.carne, name: "Carne picada", unit: "kg", milli: 12500 },
      { itemId: pan, name: "Pan de papa", unit: "u", milli: 40000 },
    ]);

    const carneMove = (await movementsOf(fx.carne)).find((m) => m.closingId !== null)!;
    ok(await editMovement(db(), { movementId: carneMove.id, userId: admin.id, newMilli: 10000, confirmNegative: false }));
    const panMove = (await movementsOf(pan)).find((m) => m.closingId !== null)!;
    ok(await editMovement(db(), { movementId: panMove.id, userId: admin.id, newMilli: 0, confirmNegative: false }));

    const [after] = await listClosings(db(), { date: "2026-10-30" });
    expect(after.lines).toEqual([{ itemId: fx.carne, name: "Carne picada", unit: "kg", milli: 10000 }]);
    expect(await itemQty(fx.carne)).toBe(50000);
    expect(await itemQty(pan)).toBe(100000);
    // The audit trail of the correction stays on the movement.
    const edits = await db().select().from(s.stockMovementEdits).where(eq(s.stockMovementEdits.movementId, carneMove.id));
    expect(edits).toMatchObject([{ previousDelta: -12500, newDelta: -10000, editedBy: admin.id }]);
    await expectLedgerConsistent();
  });

  it("lists the latest two by default, a specific day on request, and nothing for a day without closing", async () => {
    for (const [i, d] of ["2026-10-27", "2026-10-30", "2026-10-28"].entries()) ok(await close(d, [{ itemId: fx.carne, milli: 1000 * (i + 1) }], i + 1));
    expect((await listClosings(db())).map((c) => c.businessDate)).toEqual(["2026-10-30", "2026-10-28"]);
    expect((await listClosings(db(), { date: "2026-10-27" })).map((c) => [c.businessDate, c.lines[0].milli])).toEqual([["2026-10-27", 1000]]);
    expect(await listClosings(db(), { date: "2026-10-29" })).toEqual([]);
    expect(await lastClosedDate(db())).toBe("2026-10-30");
    expect(await listClosedDates(db(), "2026-10-28")).toEqual(["2026-10-30", "2026-10-28"]);
  });

  it("lastClosedDate is null before the first closing", async () => {
    expect(await lastClosedDate(db())).toBeNull();
    expect(await listClosings(db())).toEqual([]);
  });

  it("the history lists a rendición loaded the next morning under the day it closes, with its real load time", async () => {
    ok(await close("2026-10-30", [{ itemId: fx.carne, milli: 1000 }], 1)); // Friday, loaded on Saturday
    await db().execute(sql`update stock_movements set business_date = '2026-10-31' where kind = 'ajuste_inicial'`);
    const friday = await listMovements(db(), { businessDate: "2026-10-30" });
    expect(friday.map((m) => [m.itemName, m.kind, m.qtyDelta, m.closingId !== null])).toEqual([["Carne picada", "consumo", -1000, true]]);
    expect(friday[0].createdAt.getTime()).toBeGreaterThan(Date.parse("2026-10-31T00:00:00Z"));
    // Without a filter the history goes by business date: Saturday's movements first, then Friday's rendición.
    const all = await listMovements(db());
    expect(all.map((m) => m.businessDate)).toEqual(["2026-10-31", "2026-10-31", "2026-10-30"]);
    expect(await listMovements(db(), { businessDate: "2026-10-29" })).toEqual([]);
  });
});
