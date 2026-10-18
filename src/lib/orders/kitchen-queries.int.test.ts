import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { makeCadet, preparingCounterOrder, preparingWebOrder } from "@/test-support/dispatch";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { markPickup, markReady } from "./dispatch";
import { listKitchenBoard, listRecentlyReady } from "./kitchen-queries";

const db = () => testDb();
let fx: Fx;
const ready = (orderId: number) => markReady(db(), { sector: null, orderId, userId: fx.userId });

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("listKitchenBoard", () => {
  it("lists only orders en_preparacion", async () => {
    const prep = await preparingWebOrder(fx);
    const readyOne = await preparingWebOrder(fx);
    const cancelled = await preparingWebOrder(fx);
    await ready(readyOne.id);
    await db().update(s.orders).set({ status: "cancelado" }).where(eq(s.orders.id, cancelled.id));
    await placeWebOrder(fx); // still pendiente_aprobacion
    expect((await listKitchenBoard(db())).map((c) => c.id)).toEqual([prep.id]);
  });

  it("is oldest first (by when it entered the kitchen) and derives the type from fulfillment and channel", async () => {
    const web = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const takeaway = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    const counter = await preparingCounterOrder(fx, { pagerNumber: 12 });
    const base = new Date("2026-10-18T15:00:00Z").getTime();
    // Creation order is the REVERSE of the kitchen order: what counts is when it entered the kitchen.
    await db().update(s.orders).set({ createdAt: new Date(base + 2 * 60_000) }).where(eq(s.orders.id, web.id));
    await db().update(s.orders).set({ createdAt: new Date(base) }).where(eq(s.orders.id, takeaway.id));
    await db().update(s.orders).set({ createdAt: new Date(base + 60_000) }).where(eq(s.orders.id, counter.id));
    await db().update(s.orderEvents).set({ at: new Date(base + 5 * 60_000) }).where(eq(s.orderEvents.orderId, web.id));
    await db().update(s.orderEvents).set({ at: new Date(base + 6 * 60_000) }).where(eq(s.orderEvents.orderId, takeaway.id));
    await db().delete(s.orderEvents).where(eq(s.orderEvents.orderId, counter.id)); // a counter sale: falls back to its creation time
    const board = await listKitchenBoard(db());
    expect(board.map((c) => [c.id, c.type, c.pager])).toEqual([
      [counter.id, "mostrador", 12],
      [web.id, "delivery", null],
      [takeaway.id, "retiro", null],
    ]);
    expect(board[0].since).toEqual(new Date(base + 60_000));
    expect(board[1].since).toEqual(new Date(base + 5 * 60_000));
  });

  it("one card per order with units numbered and the stored kitchen labels in uppercase", async () => {
    const o = await preparingWebOrder(fx);
    const [card] = await listKitchenBoard(db());
    expect(card).toMatchObject({ id: o.id, number: o.number });
    expect(card.units.map((u) => [u.n, u.productName])).toEqual([
      [1, "Ranchita simple"],
      [2, "Ranchita simple"],
      [3, "Melt simple"],
    ]);
    expect([...card.units[0].lines].sort()).toEqual(["+ DIPS", "SIN CHEDDAR"]);
    expect(card.units[1].lines).toEqual(["COMBO"]);
    expect(card.units[2].lines).toEqual([]);
  });

  it("carries a single unit's note as plain text (HTML and emoji untouched)", async () => {
    await preparingWebOrder(fx, { units: [{ productId: fx.melt, modifierIds: [], note: "<b>sin sal</b> 🍔" }] });
    const [card] = await listKitchenBoard(db());
    expect(card.note).toBe("<b>sin sal</b> 🍔");
  });

  it("prefixes each note with its unit number when the order has several units", async () => {
    await preparingWebOrder(fx);
    const [card] = await listKitchenBoard(db());
    expect(card.note).toBe("Unidad 1: bien cocida");
  });

  it("has no note when no unit has one", async () => {
    await preparingWebOrder(fx, { units: [{ productId: fx.melt, modifierIds: [], note: "" }] });
    expect((await listKitchenBoard(db()))[0].note).toBeNull();
  });

  it("an order that re-entered the kitchen after an undo keeps its original place", async () => {
    const a = await preparingWebOrder(fx);
    const b = await preparingWebOrder(fx);
    await db().update(s.orderEvents).set({ at: new Date("2026-10-18T10:00:00Z") }).where(eq(s.orderEvents.orderId, a.id));
    await db().update(s.orderEvents).set({ at: new Date("2026-10-18T10:05:00Z") }).where(eq(s.orderEvents.orderId, b.id));
    await ready(a.id);
    await db().insert(s.orderEvents).values({ orderId: a.id, fromStatus: "listo_despacho", toStatus: "en_preparacion", userId: fx.userId });
    await db().update(s.orders).set({ status: "en_preparacion" }).where(eq(s.orders.id, a.id));
    expect((await listKitchenBoard(db())).map((c) => c.id)).toEqual([a.id, b.id]);
  });
});

describe("listRecentlyReady", () => {
  it("lists listo_despacho orders nobody has acted on, newest first, default 6", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 7; i++) {
      const o = await preparingWebOrder(fx, { fulfillment: "takeaway" });
      await ready(o.id);
      await db().update(s.orderEvents).set({ at: new Date(Date.UTC(2026, 9, 18, 15, i)) }).where(eq(s.orderEvents.orderId, o.id));
      ids.push(o.id);
    }
    const out = await listRecentlyReady(db());
    expect(out.map((c) => c.id)).toEqual(ids.slice(1).reverse());
    expect((await listRecentlyReady(db(), { limit: 2 })).map((c) => c.id)).toEqual([ids[6], ids[5]]);
  });

  it("excludes called (para_retirar), assigned (en_camino), delivered and cancelled orders", async () => {
    const keep = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const called = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    const assigned = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const delivered = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    for (const o of [keep, called, assigned, delivered]) await ready(o.id);
    await markPickup(db(), { sector: null, orderId: called.id, userId: fx.userId });
    const cadet = await makeCadet();
    await db().update(s.orders).set({ status: "en_camino", cadetId: cadet.id }).where(eq(s.orders.id, assigned.id));
    await db().update(s.orders).set({ status: "entregado" }).where(eq(s.orders.id, delivered.id));
    expect((await listRecentlyReady(db())).map((c) => c.id)).toEqual([keep.id]);
  });

  it("returns cards with their units so the strip can name them", async () => {
    const o = await preparingWebOrder(fx);
    await ready(o.id);
    const [card] = await listRecentlyReady(db());
    expect(card.id).toBe(o.id);
    expect(card.units).toHaveLength(3);
    expect(card.type).toBe("delivery");
  });
});
