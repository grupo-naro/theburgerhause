import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { testDb } from "@/db/test-utils";
import { assignCadet, markDelivered, markPickup, markReady } from "@/lib/orders/dispatch";
import { preparingCounterOrder, preparingWebOrder } from "./dispatch";
import type { Fx } from "./orders";

/** Settlement int-test fixtures: orders driven through the REAL cores to a delivery state. */

type Pay = "cash" | "transfer";
const must = <T extends { ok: boolean }>(r: T, what: string): T => {
  if (!r.ok) throw new Error(`${what} failed: ${JSON.stringify(r)}`);
  return r;
};

const UNITS = {
  one: (fx: Fx) => [{ productId: fx.ranchita, modifierIds: [], note: "" }],
  melt: (fx: Fx) => [{ productId: fx.melt, modifierIds: [], note: "" }],
  two: (fx: Fx) => [
    { productId: fx.ranchita, modifierIds: [fx.dips], note: "" },
    { productId: fx.melt, modifierIds: [], note: "" },
  ],
};
export type UnitsKind = keyof typeof UNITS;

/** A delivery order assigned to `cadetId` and still `en_camino`. */
export async function enRouteOrder(fx: Fx, cadetId: number, o: { paymentMethod?: Pay; units?: UnitsKind } = {}) {
  const order = await preparingWebOrder(fx, {
    fulfillment: "delivery",
    paymentMethod: o.paymentMethod ?? "cash",
    units: UNITS[o.units ?? "one"](fx),
  });
  must(await markReady(testDb(), { orderId: order.id, userId: fx.userId }), "markReady");
  must(await assignCadet(testDb(), { orderIds: [order.id], cadetId, userId: fx.userId }), "assignCadet");
  return order;
}

/** A delivery order delivered by `cadetId` (cash ones stay payment `pending`). */
export async function deliveredOrder(fx: Fx, cadetId: number, o: { paymentMethod?: Pay; units?: UnitsKind; now?: Date } = {}) {
  const order = await enRouteOrder(fx, cadetId, o);
  must(await markDelivered(testDb(), { orderId: order.id, userId: fx.userId }, o.now ? { now: o.now } : {}), "markDelivered");
  return order;
}

/** A takeaway order delivered at the counter (paid on pickup) - never part of a cadet balance. */
export async function deliveredTakeaway(fx: Fx) {
  const order = await preparingWebOrder(fx, { fulfillment: "takeaway", paymentMethod: "cash" });
  must(await markReady(testDb(), { orderId: order.id, userId: fx.userId }), "markReady");
  must(await markPickup(testDb(), { orderId: order.id, userId: fx.userId }), "markPickup");
  must(await markDelivered(testDb(), { orderId: order.id, userId: fx.userId, collected: true }), "markDelivered");
  return order;
}

/** A counter sale handed over at the mostrador (born paid). */
export async function deliveredCounter(fx: Fx, pagerNumber: number) {
  const order = await preparingCounterOrder(fx, { pagerNumber });
  must(await markReady(testDb(), { orderId: order.id, userId: fx.userId }), "markReady");
  must(await markPickup(testDb(), { orderId: order.id, userId: fx.userId }), "markPickup");
  must(await markDelivered(testDb(), { orderId: order.id, userId: fx.userId }), "markDelivered");
  return order;
}

export const totalOf = async (id: number) => (await testDb().select({ t: s.orders.total }).from(s.orders).where(eq(s.orders.id, id)))[0].t;
export const sumTotals = async (ids: number[]) => (await Promise.all(ids.map(totalOf))).reduce((a, b) => a + b, 0);