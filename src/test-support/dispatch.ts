import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { testDb } from "@/db/test-utils";
import { approveOrder } from "@/lib/orders/approve-order";
import { createCounterOrder } from "@/lib/orders/create-counter-order";
import { placeWebOrder, type Fx } from "./orders";

/** Dispatch int-test fixtures: real orders driven to `en_preparacion` through the real cores. */

export async function makeCadet(name = "Nahuel", over: Partial<typeof s.cadets.$inferInsert> = {}) {
  const [c] = await testDb().insert(s.cadets).values({ name, phone: "11 5555-0000", ...over }).returning();
  return c;
}

/** A web order approved into `en_preparacion` (cash orders need no verification; transfers are verified). */
export async function preparingWebOrder(
  fx: Fx,
  over: { fulfillment?: "delivery" | "takeaway"; paymentMethod?: "cash" | "transfer"; units?: unknown[] } = {},
) {
  const o = await placeWebOrder(fx, over);
  const r = await approveOrder(testDb(), { sector: null, orderId: o.id, userId: fx.userId, stationId: fx.stationId, paymentVerified: true });
  if (!r.ok) throw new Error(`approve failed: ${r.code}`);
  return o;
}

/** A counter sale (born `en_preparacion` + paid, takeaway, with a pager). */
export async function preparingCounterOrder(
  fx: Fx,
  over: { pagerNumber?: number; paymentMethod?: "cash" | "transfer"; customerName?: string; now?: Date } = {},
) {
  const r = await createCounterOrder(
    testDb(),
    {
      idempotencyKey: randomUUID(),
      units: [{ productId: fx.ranchita, modifierIds: [], note: "" }],
      paymentMethod: over.paymentMethod ?? "cash",
      pagerNumber: over.pagerNumber ?? 7,
      customerName: over.customerName ?? "Ana",
      userId: fx.userId,
      stationId: fx.stationId,
    },
    over.now ? { now: over.now } : {},
  );
  if (!r.ok) throw new Error(`counter order failed: ${r.code}`);
  return { id: r.data.orderId, number: r.data.number };
}

export async function orderRow(id: number) {
  return (await testDb().select().from(s.orders).where(eq(s.orders.id, id)))[0];
}
export const orderEventsOf = (orderId: number) =>
  testDb().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, orderId)).orderBy(s.orderEvents.id);
