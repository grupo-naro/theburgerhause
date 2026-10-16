import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { getEnv } from "@/lib/env";
import { makeCadet, preparingCounterOrder, preparingWebOrder } from "@/test-support/dispatch";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { assignCadet, markDelivered, markPickup, markReady } from "./dispatch";
import { getDispatchBoard } from "./dispatch-queries";

const db = () => testDb();
let fx: Fx;
const NOW = new Date("2026-10-15T20:00:00Z");

const ready = (orderId: number) => markReady(db(), { orderId, userId: fx.userId });
const setCreatedAt = (id: number, iso: string) =>
  db().update(s.orders).set({ createdAt: new Date(iso) }).where(eq(s.orders.id, id));
const board = () => getDispatchBoard(db(), { now: NOW });

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("getDispatchBoard", () => {
  it("is empty on an empty database", async () => {
    expect(await board()).toEqual({ preparing: [], ready: { delivery: [], takeaway: [] }, pickup: [], enRoute: [], cadets: [] });
  });

  it("places orders in their columns, oldest first, and leaves out other states", async () => {
    const pending = await placeWebOrder(fx); // pendiente_aprobacion: not shown
    const prepNew = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const prepOld = await preparingCounterOrder(fx, { pagerNumber: 12 });
    const dNew = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const dOld = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const tk = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    const pick = await preparingCounterOrder(fx, { pagerNumber: 45 });
    const done = await preparingCounterOrder(fx, { pagerNumber: 46 });
    const cancelled = await placeWebOrder(fx);
    await db().update(s.orders).set({ status: "cancelado" }).where(eq(s.orders.id, cancelled.id));
    for (const o of [dNew, dOld, tk, pick, done]) await ready(o.id);
    await markPickup(db(), { orderId: pick.id, userId: fx.userId });
    await markPickup(db(), { orderId: done.id, userId: fx.userId });
    await markDelivered(db(), { orderId: done.id, userId: fx.userId });

    await setCreatedAt(prepNew.id, "2026-10-15T19:50:00Z");
    await setCreatedAt(prepOld.id, "2026-10-15T19:30:00Z");
    await setCreatedAt(dNew.id, "2026-10-15T19:40:00Z");
    await setCreatedAt(dOld.id, "2026-10-15T19:10:00Z");
    await setCreatedAt(pending.id, "2026-10-15T18:00:00Z");

    const b = await board();
    expect(b.preparing.map((o) => o.id)).toEqual([prepOld.id, prepNew.id]);
    expect(b.preparing[0]).toMatchObject({ channel: "counter", fulfillment: "takeaway", pagerNumber: 12, status: "en_preparacion", minutesWaiting: 30 });
    expect(b.preparing[1]).toMatchObject({ channel: "web", minutesWaiting: 10, pagerNumber: null });
    expect(b.ready.delivery.map((o) => o.id)).toEqual([dOld.id, dNew.id]);
    expect(b.ready.delivery[0]).toMatchObject({
      fulfillment: "delivery",
      status: "listo_despacho",
      address: "Av. Siempreviva 742",
      crossStreets: "Mitre y Sarmiento",
      addressNotes: "timbre roto",
      customerName: "Juana",
      minutesWaiting: 50,
    });
    expect(b.ready.takeaway.map((o) => o.id)).toEqual([tk.id]);
    expect(b.pickup.map((o) => o.id)).toEqual([pick.id]);
    expect(b.pickup[0]).toMatchObject({ pagerNumber: 45, status: "para_retirar", channel: "counter" });
    expect(b.enRoute).toEqual([]);
    const all = [...b.preparing, ...b.ready.delivery, ...b.ready.takeaway, ...b.pickup].map((o) => o.id);
    expect(all).not.toContain(pending.id);
    expect(all).not.toContain(cancelled.id);
    expect(all).not.toContain(done.id);
  });

  it("DTO carries grouped items with kitchen labels and the print state", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
    await ready(o.id);
    const [dto] = (await board()).ready.delivery;
    expect(dto).toMatchObject({ id: o.id, number: o.number, paymentMethod: "cash", paymentStatus: "pending", createdAt: expect.any(String) });
    expect(dto.total).toBeGreaterThan(0);
    expect(dto.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(dto.items)).toContain("SIN CHEDDAR");
    expect(dto.printState).toEqual({ pending: 2, failed: 0, done: 0 });
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });

  it("en route: grouped by cadet, oldest assignment first, cashPending = cash pending totals", async () => {
    const o1 = await preparingWebOrder(fx, { fulfillment: "delivery", paymentMethod: "cash" });
    const o2 = await preparingWebOrder(fx, { fulfillment: "delivery", paymentMethod: "transfer" });
    const o3 = await preparingWebOrder(fx, { fulfillment: "delivery", paymentMethod: "cash" });
    const o4 = await preparingWebOrder(fx, { fulfillment: "delivery", paymentMethod: "cash" });
    for (const o of [o1, o2, o3, o4]) await ready(o.id);
    const zeta = await makeCadet("Zeta");
    const alfa = await makeCadet("Alfa");
    await assignCadet(db(), { orderIds: [o3.id], cadetId: zeta.id, userId: fx.userId });
    await new Promise((r) => setTimeout(r, 20));
    await assignCadet(db(), { orderIds: [o1.id, o2.id], cadetId: alfa.id, userId: fx.userId });

    const b = await board();
    expect(b.ready.delivery.map((o) => o.id)).toEqual([o4.id]);
    expect(b.enRoute.map((g) => g.cadet)).toEqual([
      { id: zeta.id, name: "Zeta" },
      { id: alfa.id, name: "Alfa" },
    ]);
    const total = async (id: number) => (await db().select().from(s.orders).where(eq(s.orders.id, id)))[0].total;
    expect(b.enRoute[0].cashPending).toBe(await total(o3.id));
    expect(b.enRoute[1].cashPending).toBe(await total(o1.id)); // o2 is a paid transfer
    expect(b.enRoute[1].orders.map((o) => o.id).sort()).toEqual([o1.id, o2.id].sort());
  });

  it("cadets: active only, by name, with enRouteCount and cashDelivered (cash pending, delivered)", async () => {
    const zeta = await makeCadet("Zeta");
    const alfa = await makeCadet("Alfa");
    await makeCadet("Inactivo", { active: false });
    const orders = [];
    for (const pm of ["cash", "cash", "transfer", "cash"] as const) {
      const o = await preparingWebOrder(fx, { fulfillment: "delivery", paymentMethod: pm });
      await ready(o.id);
      orders.push(o);
    }
    await assignCadet(db(), { orderIds: orders.map((o) => o.id), cadetId: alfa.id, userId: fx.userId });
    for (const o of orders.slice(0, 3)) await markDelivered(db(), { orderId: o.id, userId: fx.userId });
    const total = async (id: number) => (await db().select().from(s.orders).where(eq(s.orders.id, id)))[0].total;

    const b = await board();
    expect(b.cadets.map((c) => c.name)).toEqual(["Alfa", "Zeta"]);
    expect(b.cadets[0]).toMatchObject({ id: alfa.id, phone: "11 5555-0000", active: true, enRouteCount: 1 });
    // delivered: cash#1, cash#2 (pending) + transfer (paid, not owed); the 4th is still en camino
    expect(b.cadets[0].cashDelivered).toBe((await total(orders[0].id)) + (await total(orders[1].id)));
    expect(b.cadets[1]).toMatchObject({ id: zeta.id, enRouteCount: 0, cashDelivered: 0 });
  });

  it("does not run a query per order (constant statement count)", async () => {
    const cadet = await makeCadet();
    const count = async () => {
      const statements: string[] = [];
      const pool = new Pool({ connectionString: getEnv().DATABASE_URL });
      const spy = drizzle(pool, { logger: { logQuery: (q) => void statements.push(q) } });
      try {
        await getDispatchBoard(spy, { now: NOW });
      } finally {
        await pool.end();
      }
      return statements.length;
    };
    for (let i = 0; i < 2; i++) await ready((await preparingWebOrder(fx)).id);
    const few = await count();
    for (let i = 0; i < 6; i++) {
      const o = await preparingWebOrder(fx);
      await ready(o.id);
      if (i % 2 === 0) await assignCadet(db(), { orderIds: [o.id], cadetId: cadet.id, userId: fx.userId });
    }
    for (let i = 0; i < 3; i++) await preparingCounterOrder(fx, { pagerNumber: 100 + i });
    const many = await count();
    expect(many).toBe(few);
    expect(many).toBeLessThanOrEqual(6);
  });
});
