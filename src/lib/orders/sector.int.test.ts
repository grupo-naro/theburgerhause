import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { makeCadet, orderEventsOf, orderRow, preparingCounterOrder, preparingWebOrder } from "@/test-support/dispatch";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { approveOrder } from "./approve-order";
import { listFailedPrintJobs, listPendingApproval, listRecentProcessed } from "./caja-queries";
import { assignCadet, markDelivered, markPickup, markReady, returnToDispatch } from "./dispatch";
import { getDispatchBoard } from "./dispatch-queries";
import { rejectOrder } from "./reject-order";
import { reprintOrder } from "./reprint";
import { getStationHeader } from "@/lib/stations/header";
import { WRONG_SECTOR_MESSAGE } from "./sector";

const db = () => testDb();
let fx: Fx;

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

const approve = (orderId: number, sector: "mostrador" | "delivery" | null = null, stationId = fx.stationId) =>
  approveOrder(db(), { orderId, userId: fx.userId, stationId, paymentVerified: true, sector });

/** A full snapshot of the order, its events and the print jobs: a rejected action must leave it untouched. */
async function snapshot(orderId: number) {
  const [order, events, jobs] = await Promise.all([
    orderRow(orderId),
    orderEventsOf(orderId),
    db().select().from(s.printJobs).where(eq(s.printJobs.orderId, orderId)),
  ]);
  return JSON.stringify({ order, events, jobs });
}

describe("queries filter by sector", () => {
  it("listPendingApproval: delivery sector sees only delivery, mostrador only takeaway", async () => {
    const d = await placeWebOrder(fx, { fulfillment: "delivery" });
    const t = await placeWebOrder(fx, { fulfillment: "takeaway" });
    expect((await listPendingApproval(db(), { sector: "delivery" })).map((o) => o.id)).toEqual([d.id]);
    expect((await listPendingApproval(db(), { sector: "mostrador" })).map((o) => o.id)).toEqual([t.id]);
    expect((await listPendingApproval(db(), {})).map((o) => o.id).sort()).toEqual([d.id, t.id].sort());
  });

  it("listRecentProcessed: same split, counter sales belong to mostrador", async () => {
    const d = await placeWebOrder(fx, { fulfillment: "delivery" });
    const t = await placeWebOrder(fx, { fulfillment: "takeaway" });
    await approve(d.id);
    await approve(t.id);
    const c = await preparingCounterOrder(fx);
    const delivery = (await listRecentProcessed(db(), { sector: "delivery" })).map((o) => o.id);
    const mostrador = (await listRecentProcessed(db(), { sector: "mostrador" })).map((o) => o.id);
    expect(delivery).toEqual([d.id]);
    expect(mostrador.sort()).toEqual([t.id, c.id].sort());
    expect(await listRecentProcessed(db(), {})).toHaveLength(3);
  });

  it("channel narrows further (web takeaway vs counter sales)", async () => {
    const t = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    const c = await preparingCounterOrder(fx);
    const web = await getDispatchBoard(db(), { sector: "mostrador", channel: "web" });
    const counter = await getDispatchBoard(db(), { sector: "mostrador", channel: "counter" });
    expect(web.preparing.map((o) => o.id)).toEqual([t.id]);
    expect(counter.preparing.map((o) => o.id)).toEqual([c.id]);
  });

  it("getDispatchBoard: lanes only hold the sector's orders; delivery keeps cadets and en-route, mostrador has none", async () => {
    const cadet = await makeCadet("Nahuel");
    const dPrep = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const dReady = await preparingWebOrder(fx, { fulfillment: "delivery" });
    await markReady(db(), { sector: null, orderId: dReady.id, userId: fx.userId });
    const dRoute = await preparingWebOrder(fx, { fulfillment: "delivery" });
    await markReady(db(), { sector: null, orderId: dRoute.id, userId: fx.userId });
    await assignCadet(db(), { sector: null, orderIds: [dRoute.id], cadetId: cadet.id, userId: fx.userId });
    const tReady = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    await markReady(db(), { sector: null, orderId: tReady.id, userId: fx.userId });
    const tPickup = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    await markReady(db(), { sector: null, orderId: tPickup.id, userId: fx.userId });
    await markPickup(db(), { sector: null, orderId: tPickup.id, userId: fx.userId });
    const cPrep = await preparingCounterOrder(fx);

    const del = await getDispatchBoard(db(), { sector: "delivery" });
    expect(del.preparing.map((o) => o.id)).toEqual([dPrep.id]);
    expect(del.ready.delivery.map((o) => o.id)).toEqual([dReady.id]);
    expect(del.ready.takeaway).toEqual([]);
    expect(del.pickup).toEqual([]);
    expect(del.enRoute.flatMap((g) => g.orders.map((o) => o.id))).toEqual([dRoute.id]);
    expect(del.cadets.map((c) => c.id)).toEqual([cadet.id]);

    const mos = await getDispatchBoard(db(), { sector: "mostrador" });
    expect(mos.preparing.map((o) => o.id)).toEqual([cPrep.id]);
    expect(mos.ready.delivery).toEqual([]);
    expect(mos.ready.takeaway.map((o) => o.id)).toEqual([tReady.id]);
    expect(mos.pickup.map((o) => o.id)).toEqual([tPickup.id]);
    expect(mos.enRoute).toEqual([]);
    expect(mos.cadets).toEqual([]);

    const all = await getDispatchBoard(db(), {});
    expect(all.preparing).toHaveLength(2);
    expect(all.cadets).toHaveLength(1);
  });

  it("listFailedPrintJobs: alerts of the other sector are not listed", async () => {
    const d = await placeWebOrder(fx, { fulfillment: "delivery" });
    const t = await placeWebOrder(fx, { fulfillment: "takeaway" });
    await approve(d.id);
    await approve(t.id);
    await db().update(s.printJobs).set({ status: "failed", error: "sin papel" });
    expect((await listFailedPrintJobs(db(), fx.stationId, { sector: "delivery" })).map((j) => j.orderId)).toEqual([d.id, d.id]);
    expect((await listFailedPrintJobs(db(), fx.stationId, { sector: "mostrador" })).map((j) => j.orderId)).toEqual([t.id, t.id]);
    expect(await listFailedPrintJobs(db(), fx.stationId)).toHaveLength(4);
    expect(await listFailedPrintJobs(db(), undefined, { sector: "delivery" })).toHaveLength(2);
  });
});

describe("cores reject the wrong sector BEFORE any write; admin (no sector) is exempt", () => {
  it("approveOrder: mostrador station on a delivery order -> WRONG_SECTOR, nothing written", async () => {
    const d = await placeWebOrder(fx, { fulfillment: "delivery" });
    const before = await snapshot(d.id);
    const r = await approve(d.id, "mostrador");
    expect(r).toEqual({ ok: false, code: "WRONG_SECTOR", message: WRONG_SECTOR_MESSAGE });
    expect(await snapshot(d.id)).toBe(before);
    expect((await orderRow(d.id)).status).toBe("pendiente_aprobacion");
  });

  it("approveOrder: delivery station on a takeaway order -> WRONG_SECTOR; the right sector and admin succeed and print on the approving station", async () => {
    const t = await placeWebOrder(fx, { fulfillment: "takeaway" });
    const before = await snapshot(t.id);
    expect(await approve(t.id, "delivery", fx.otherStationId)).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await snapshot(t.id)).toBe(before);
    expect(await approve(t.id, "mostrador")).toMatchObject({ ok: true });
    const d = await placeWebOrder(fx, { fulfillment: "delivery" });
    expect(await approve(d.id, null, fx.otherStationId)).toMatchObject({ ok: true });
    const jobs = await db().select().from(s.printJobs).where(eq(s.printJobs.orderId, d.id));
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.stationId === fx.otherStationId)).toBe(true);
  });

  it("approveOrder: the sector check comes before the payment verification rule", async () => {
    const d = await placeWebOrder(fx, { fulfillment: "delivery", paymentMethod: "transfer" });
    const r = await approveOrder(db(), { orderId: d.id, userId: fx.userId, stationId: fx.stationId, paymentVerified: false, sector: "mostrador" });
    expect(r).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
  });

  it("rejectOrder", async () => {
    const d = await placeWebOrder(fx, { fulfillment: "delivery" });
    const before = await snapshot(d.id);
    const r = await rejectOrder(db(), { orderId: d.id, userId: fx.userId, reason: "sin stock", sector: "mostrador" });
    expect(r).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await snapshot(d.id)).toBe(before);
    expect(await rejectOrder(db(), { orderId: d.id, userId: fx.userId, reason: "sin stock", sector: "delivery" })).toMatchObject({ ok: true });
    const t = await placeWebOrder(fx, { fulfillment: "takeaway" });
    expect(await rejectOrder(db(), { orderId: t.id, userId: fx.userId, reason: "sin stock", sector: null })).toMatchObject({ ok: true });
  });

  it("reprintOrder", async () => {
    const d = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const before = await snapshot(d.id);
    const base = { orderId: d.id, userId: fx.userId, stationId: fx.stationId, which: "both" as const };
    expect(await reprintOrder(db(), { ...base, sector: "mostrador" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await snapshot(d.id)).toBe(before);
    expect(await reprintOrder(db(), { ...base, sector: "delivery" })).toMatchObject({ ok: true });
    expect(await reprintOrder(db(), { ...base, sector: null })).toMatchObject({ ok: true });
  });

  it("markReady / markPickup / markDelivered / returnToDispatch", async () => {
    const d = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const t = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    const dBefore = await snapshot(d.id);
    const tBefore = await snapshot(t.id);
    expect(await markReady(db(), { orderId: d.id, userId: fx.userId, sector: "mostrador" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await markReady(db(), { orderId: t.id, userId: fx.userId, sector: "delivery" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await snapshot(d.id)).toBe(dBefore);
    expect(await snapshot(t.id)).toBe(tBefore);

    expect(await markReady(db(), { orderId: t.id, userId: fx.userId, sector: "mostrador" })).toMatchObject({ ok: true });
    expect(await markReady(db(), { orderId: d.id, userId: fx.userId, sector: null })).toMatchObject({ ok: true });

    const tReady = await snapshot(t.id);
    expect(await markPickup(db(), { orderId: t.id, userId: fx.userId, sector: "delivery" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await snapshot(t.id)).toBe(tReady);
    expect(await markPickup(db(), { orderId: t.id, userId: fx.userId, sector: "mostrador" })).toMatchObject({ ok: true });

    const tPickup = await snapshot(t.id);
    expect(await markDelivered(db(), { orderId: t.id, userId: fx.userId, collected: true, sector: "delivery" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await snapshot(t.id)).toBe(tPickup);
    expect(await markDelivered(db(), { orderId: t.id, userId: fx.userId, collected: true, sector: "mostrador" })).toMatchObject({ ok: true });

    const cadet = await makeCadet();
    await assignCadet(db(), { orderIds: [d.id], cadetId: cadet.id, userId: fx.userId, sector: "delivery" });
    const dRoute = await snapshot(d.id);
    expect(await returnToDispatch(db(), { orderId: d.id, userId: fx.userId, reason: "no estaba", sector: "mostrador" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await markDelivered(db(), { orderId: d.id, userId: fx.userId, sector: "mostrador" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await snapshot(d.id)).toBe(dRoute);
    expect(await returnToDispatch(db(), { orderId: d.id, userId: fx.userId, reason: "no estaba", sector: "delivery" })).toMatchObject({ ok: true });
  });

  it("assignCadet: a mostrador sector never assigns; the foreign order is listed", async () => {
    const cadet = await makeCadet();
    const d = await preparingWebOrder(fx, { fulfillment: "delivery" });
    await markReady(db(), { sector: null, orderId: d.id, userId: fx.userId });
    const before = await snapshot(d.id);
    const r = await assignCadet(db(), { orderIds: [d.id], cadetId: cadet.id, userId: fx.userId, sector: "mostrador" });
    expect(r).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    if (!r.ok) expect(r.details?.map((x) => x.orderId)).toEqual([d.id]);
    expect(await snapshot(d.id)).toBe(before);
    expect(await assignCadet(db(), { orderIds: [d.id], cadetId: cadet.id, userId: fx.userId, sector: "delivery" })).toMatchObject({ ok: true });
  });
});

describe("station header failed-print count is scoped like the workspace list", () => {
  it("a delivery order printed on a Mostrador station by an admin does not make the cashier's header red", async () => {
    const d = await placeWebOrder(fx, { fulfillment: "delivery" });
    const t = await placeWebOrder(fx, { fulfillment: "takeaway" });
    await approve(d.id, null, fx.stationId); // admin approves a delivery order at the Mostrador station
    await approve(t.id, "mostrador", fx.stationId);
    await db().update(s.printJobs).set({ status: "failed", error: "sin papel" });
    const own = await getStationHeader(db(), fx.stationId, "mostrador");
    expect(own?.failedCount).toBe((await listFailedPrintJobs(db(), fx.stationId, { sector: "mostrador" })).length);
    expect(own?.failedCount).toBe(2); // only the takeaway order's two jobs
    expect((await getStationHeader(db(), fx.stationId, null))?.failedCount).toBe(4); // admin: the station's own jobs, all of them
  });
});
