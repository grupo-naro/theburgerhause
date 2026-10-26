import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { makeCadet, preparingCounterOrder, preparingWebOrder } from "@/test-support/dispatch";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { getCounterBoard } from "./counter-board";
import { assignCadet, markDelivered, markPickup, markReady } from "./dispatch";
import { reprintOrder } from "./reprint";

const db = () => testDb();
let fx: Fx;
let pager = 10;
const counter = () => preparingCounterOrder(fx, { pagerNumber: ++pager });
const ready = async (orderId: number) => {
  const r = await markReady(db(), { sector: null, orderId, userId: fx.userId });
  if (!r.ok) throw new Error(r.message);
};
const pickup = async (orderId: number) => {
  const r = await markPickup(db(), { sector: null, orderId, userId: fx.userId });
  if (!r.ok) throw new Error(r.message);
};
const base = new Date("2026-10-24T20:00:00Z").getTime();
const min = (m: number) => new Date(base + m * 60_000);
/** Moves when the order entered `to` (every real event into that status). */
const enteredAt = (orderId: number, to: (typeof s.orderEvents.$inferSelect)["toStatus"], at: Date) =>
  db()
    .update(s.orderEvents)
    .set({ at })
    .where(and(eq(s.orderEvents.orderId, orderId), eq(s.orderEvents.toStatus, to)));
const ids = (rows: { id: number }[]) => rows.map((r) => r.id);

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("getCounterBoard", () => {
  it("counter sales and web takeaway orders in preparation appear, with their order number only", async () => {
    const pos = await counter();
    const web = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    const board = await getCounterBoard(db());
    expect(ids(board.preparing).sort()).toEqual([pos.id, web.id].sort());
    expect(board.ready).toEqual([]);
    for (const row of board.preparing) expect(Object.keys(row).sort()).toEqual(["id", "number"]);
    expect(board.preparing.find((r) => r.id === pos.id)!.number).toBe(pos.number);
    expect(board.preparing.find((r) => r.id === web.id)!.number).toBe(web.number);
  });

  it("NEVER shows a delivery order: in preparation, ready or on its way", async () => {
    const prep = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const readyOne = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const route = await preparingWebOrder(fx, { fulfillment: "delivery" });
    await ready(readyOne.id);
    await ready(route.id);
    const cadet = await makeCadet();
    const a = await assignCadet(db(), { sector: null, orderIds: [route.id], cadetId: cadet.id, userId: fx.userId });
    expect(a.ok).toBe(true);
    // Even a (hypothetical) counter-channel delivery row stays off the screen.
    const odd = await counter();
    await db().update(s.orders).set({ fulfillment: "delivery" }).where(eq(s.orders.id, odd.id));
    const board = await getCounterBoard(db());
    expect(board).toEqual({ preparing: [], ready: [] });
    expect([prep.id, readyOne.id, route.id, odd.id].length).toBe(4);
  });

  it("leaves out pending approval, cancelled, delivered and en_camino orders", async () => {
    await placeWebOrder(fx, { fulfillment: "takeaway" }); // pendiente_aprobacion
    const cancelled = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    await db().update(s.orders).set({ status: "cancelado" }).where(eq(s.orders.id, cancelled.id));
    const delivered = await counter();
    await ready(delivered.id);
    await pickup(delivered.id);
    const d = await markDelivered(db(), { sector: null, orderId: delivered.id, userId: fx.userId });
    expect(d.ok).toBe(true);
    const enRoute = await counter();
    await db().update(s.orders).set({ status: "en_camino" }).where(eq(s.orders.id, enRoute.id));
    expect(await getCounterBoard(db())).toEqual({ preparing: [], ready: [] });
  });

  it("listo_despacho and para_retirar are in `ready`, with when they became ready", async () => {
    const a = await counter();
    const b = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    const c = await counter();
    await ready(a.id);
    await ready(b.id);
    await pickup(b.id);
    const board = await getCounterBoard(db());
    expect(ids(board.preparing)).toEqual([c.id]);
    expect(ids(board.ready).sort()).toEqual([a.id, b.id].sort());
    for (const row of board.ready) expect(row.readySince).toBeInstanceOf(Date);
  });

  it("oldest first in each zone, by when it ENTERED that zone (not by creation)", async () => {
    const p1 = await counter();
    const p2 = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    const p3 = await counter();
    await enteredAt(p1.id, "en_preparacion", min(10));
    await enteredAt(p2.id, "en_preparacion", min(2));
    await enteredAt(p3.id, "en_preparacion", min(5));
    const r1 = await counter();
    const r2 = await counter();
    const r3 = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    for (const r of [r1, r2, r3]) await ready(r.id);
    await pickup(r1.id); // listo_despacho -> para_retirar does not move it: it was already ready
    await enteredAt(r1.id, "listo_despacho", min(30));
    await enteredAt(r1.id, "para_retirar", min(50));
    await enteredAt(r2.id, "listo_despacho", min(40));
    await enteredAt(r3.id, "listo_despacho", min(20));

    const board = await getCounterBoard(db());
    expect(ids(board.preparing)).toEqual([p2.id, p3.id, p1.id]);
    expect(ids(board.ready)).toEqual([r3.id, r1.id, r2.id]);
    expect(board.ready.map((r) => r.readySince)).toEqual([min(20), min(30), min(40)]);
  });

  it("a reprint (same-status event) does not change the order", async () => {
    const a = await counter();
    const b = await counter();
    await enteredAt(a.id, "en_preparacion", min(1));
    await enteredAt(b.id, "en_preparacion", min(2));
    const r = await reprintOrder(db(), { orderId: a.id, userId: fx.userId, stationId: fx.stationId, which: "customer", sector: null });
    expect(r.ok).toBe(true);
    const events = await db().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, a.id));
    const reprint = events.find((e) => e.fromStatus === e.toStatus)!;
    await db().update(s.orderEvents).set({ at: min(60) }).where(eq(s.orderEvents.id, reprint.id));
    expect(ids((await getCounterBoard(db())).preparing)).toEqual([a.id, b.id]);

    await ready(a.id);
    await ready(b.id);
    await enteredAt(a.id, "listo_despacho", min(10));
    await enteredAt(b.id, "listo_despacho", min(11));
    const again = await reprintOrder(db(), { orderId: a.id, userId: fx.userId, stationId: fx.stationId, which: "customer", sector: null });
    expect(again.ok).toBe(true);
    // The reprint event (listo_despacho -> listo_despacho) is the latest into that status, but it is not a transition.
    const latest = (await db().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, a.id))).at(-1)!;
    expect(latest.fromStatus).toBe(latest.toStatus);
    await db().update(s.orderEvents).set({ at: min(90) }).where(eq(s.orderEvents.id, latest.id));
    const board = await getCounterBoard(db());
    expect(ids(board.ready)).toEqual([a.id, b.id]);
    expect(board.ready[0].readySince).toEqual(min(10));
  });

  it("an order that goes back from Ready to preparation is in `preparing` again, by its latest entry", async () => {
    const a = await counter();
    const b = await counter();
    await enteredAt(a.id, "en_preparacion", min(1));
    await enteredAt(b.id, "en_preparacion", min(5));
    await ready(a.id);
    // Back to preparation (as the dispatch flow allows), recorded as a real transition.
    await db().update(s.orders).set({ status: "en_preparacion" }).where(eq(s.orders.id, a.id));
    await db().insert(s.orderEvents).values({ orderId: a.id, fromStatus: "listo_despacho", toStatus: "en_preparacion", userId: fx.userId, at: min(9) });
    const board = await getCounterBoard(db());
    expect(ids(board.preparing)).toEqual([b.id, a.id]);
    expect(board.ready).toEqual([]);
  });

  it("legacy rows without events fall back to the creation time", async () => {
    const a = await counter();
    const b = await counter();
    await db().delete(s.orderEvents).where(eq(s.orderEvents.orderId, b.id));
    await db().update(s.orders).set({ createdAt: min(-100) }).where(eq(s.orders.id, b.id));
    expect(ids((await getCounterBoard(db(), { now: min(0) })).preparing)).toEqual([b.id, a.id]);
  });
});
