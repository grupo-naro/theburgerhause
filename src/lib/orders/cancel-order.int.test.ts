import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { listFailedPrintJobs } from "@/lib/orders/caja-queries";
import { listCadetBalances } from "@/lib/settlements/queries";
import { settleCadet } from "@/lib/settlements/settle-cadet";
import { makeCadet, orderEventsOf, orderRow, preparingCounterOrder, preparingWebOrder } from "@/test-support/dispatch";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { cancelOrder } from "./cancel-order";
import { assignCadet, markDelivered, markPickup, markReady, returnToDispatch } from "./dispatch";
import { getOrderPrintState } from "./print-state";
import { reprintOrder } from "./reprint";
import { getOrderForTracking } from "./tracking";

const db = () => testDb();
let fx: Fx;

const cancel = (orderId: number, reason = "Cliente canceló", over: Partial<Parameters<typeof cancelOrder>[1]> = {}) =>
  cancelOrder(db(), { orderId, userId: fx.userId, reason, sector: null, ...over });
const ready = (orderId: number) => markReady(db(), { orderId, userId: fx.userId, sector: null });

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("cancelOrder (after approval)", () => {
  it("cancels from en_preparacion with the reason in the event, payment status untouched", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "delivery", paymentMethod: "transfer" });
    const before = await orderRow(o.id);
    expect(await cancel(o.id, "  Se cayó el pedido ")).toEqual({ ok: true, data: { orderId: o.id, status: "cancelado" } });
    const after = await orderRow(o.id);
    expect(after.status).toBe("cancelado");
    expect(after.paymentStatus).toBe(before.paymentStatus);
    const evs = await orderEventsOf(o.id);
    expect(evs.at(-1)).toMatchObject({ fromStatus: "en_preparacion", toStatus: "cancelado", userId: fx.userId, note: "Se cayó el pedido" });
  });

  it("cancels from listo_despacho and from para_retirar", async () => {
    const a = await preparingWebOrder(fx, { fulfillment: "delivery" });
    await ready(a.id);
    expect(await cancel(a.id)).toMatchObject({ ok: true });
    const b = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    await ready(b.id);
    await markPickup(db(), { orderId: b.id, userId: fx.userId, sector: null });
    expect(await cancel(b.id)).toMatchObject({ ok: true });
    expect((await orderEventsOf(b.id)).at(-1)).toMatchObject({ fromStatus: "para_retirar", toStatus: "cancelado" });
  });

  it.each(["", "   ", "ab", "x".repeat(201)])("the reason is mandatory (%j)", async (reason) => {
    const o = await preparingWebOrder(fx);
    expect(await cancel(o.id, reason)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect((await orderRow(o.id)).status).toBe("en_preparacion");
  });

  it("refuses en_camino, entregado, pendiente_aprobacion and cancelado", async () => {
    const cadet = await makeCadet();
    const route = await preparingWebOrder(fx, { fulfillment: "delivery" });
    await ready(route.id);
    await assignCadet(db(), { orderIds: [route.id], cadetId: cadet.id, userId: fx.userId, sector: null });
    expect(await cancel(route.id)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect((await orderRow(route.id)).status).toBe("en_camino");

    const done = await preparingWebOrder(fx, { fulfillment: "takeaway", paymentMethod: "transfer" });
    await ready(done.id);
    await markPickup(db(), { orderId: done.id, userId: fx.userId, sector: null });
    await markDelivered(db(), { orderId: done.id, userId: fx.userId, sector: null, collected: true });
    expect(await cancel(done.id)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });

    const pending = await placeWebOrder(fx);
    expect(await cancel(pending.id)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });

    const gone = await preparingWebOrder(fx);
    await cancel(gone.id);
    expect(await cancel(gone.id)).toEqual({ ok: false, code: "INVALID_TRANSITION", message: "Este pedido fue cancelado" });
    expect((await orderEventsOf(gone.id)).filter((e) => e.toStatus === "cancelado")).toHaveLength(1);
  });

  it("a delivery returned to dispatch can be cancelled and leaves the cadet balance and settlement", async () => {
    const cadet = await makeCadet();
    const a = await preparingWebOrder(fx, { fulfillment: "delivery", paymentMethod: "cash" });
    const b = await preparingWebOrder(fx, { fulfillment: "delivery", paymentMethod: "cash" });
    await ready(a.id);
    await ready(b.id);
    await assignCadet(db(), { orderIds: [a.id, b.id], cadetId: cadet.id, userId: fx.userId, sector: null });
    await markDelivered(db(), { orderId: a.id, userId: fx.userId, sector: null });
    await returnToDispatch(db(), { orderId: b.id, userId: fx.userId, sector: null, reason: "No atendió" });
    expect(await cancel(b.id, "Cliente no responde")).toMatchObject({ ok: true });

    const rowA = await orderRow(a.id);
    const bal = (await listCadetBalances(db())).find((c) => c.cadetId === cadet.id)!;
    expect(bal.owed).toBe(rowA.total);
    const settled = await settleCadet(db(), { cadetId: cadet.id, expectedAmount: rowA.total, userId: fx.userId });
    expect(settled).toMatchObject({ ok: true, data: { amount: rowA.total, orderCount: 1 } });
    expect((await orderRow(b.id)).status).toBe("cancelado");
    expect((await orderRow(b.id)).paymentStatus).toBe("pending");
  });

  it("sector rule: delivery orders only by the delivery sector, takeaway/counter by the counter sector, admin anywhere", async () => {
    const del = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const tk = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    expect(await cancel(del.id, "Cliente canceló", { sector: "mostrador" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await cancel(tk.id, "Cliente canceló", { sector: "delivery" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect((await orderRow(del.id)).status).toBe("en_preparacion");
    expect((await orderRow(tk.id)).status).toBe("en_preparacion");
    expect(await cancel(del.id, "Cliente canceló", { sector: "delivery" })).toMatchObject({ ok: true });
    expect(await cancel(tk.id, "Cliente canceló", { sector: "mostrador" })).toMatchObject({ ok: true });
    const c = await preparingCounterOrder(fx);
    expect(await cancel(c.id, "Error de carga", { sector: "delivery" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await cancel(c.id, "Error de carga", { sector: null })).toMatchObject({ ok: true });
  });

  it("voiding a counter sale frees its pager", async () => {
    const c = await preparingCounterOrder(fx, { pagerNumber: 7 });
    await cancel(c.id, "Error de carga");
    const again = await preparingCounterOrder(fx, { pagerNumber: 7 });
    expect(again.id).not.toBe(c.id);
    expect((await orderRow(again.id)).status).toBe("en_preparacion");
  });

  it("unclaimed print jobs of the cancelled order are failed and never raise the failed-print alert; reprint is refused", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    expect((await db().select().from(s.printJobs).where(eq(s.printJobs.orderId, o.id))).some((j) => j.status === "pending")).toBe(true);
    await cancel(o.id);
    const jobs = await db().select().from(s.printJobs).where(eq(s.printJobs.orderId, o.id));
    expect(jobs.every((j) => j.status === "failed" && j.error === "pedido cancelado")).toBe(true);
    expect(await listFailedPrintJobs(db())).toEqual([]);
    expect(await getOrderPrintState(db(), o.id)).toMatchObject({ failed: 0, pending: 0 });
    expect(await reprintOrder(db(), { orderId: o.id, userId: fx.userId, stationId: fx.stationId, which: "customer", sector: null })).toMatchObject({
      ok: false,
      code: "INVALID_TRANSITION",
    });
  });

  it("the customer tracking page shows the order as cancelled", async () => {
    const o = await preparingWebOrder(fx);
    await cancel(o.id);
    const [row] = await db().select({ token: s.orders.publicToken }).from(s.orders).where(eq(s.orders.id, o.id));
    expect(await getOrderForTracking(db(), row.token)).toMatchObject({ status: "cancelado" });
  });

  it("parallel cancel vs markReady: one wins, the state stays consistent", async () => {
    for (let i = 0; i < 5; i++) {
      const o = await preparingWebOrder(fx, { fulfillment: "takeaway" });
      const [c, r] = await Promise.all([cancel(o.id), ready(o.id)]);
      const row = await orderRow(o.id);
      // cancel wins outright, or markReady ran first (listo_despacho) and cancel then voided it: never a stuck middle state.
      expect(c.ok).toBe(true);
      expect(row.status).toBe("cancelado");
      expect((await orderEventsOf(o.id)).filter((e) => e.toStatus === "cancelado")).toHaveLength(1);
      void r;
    }
  });
});
