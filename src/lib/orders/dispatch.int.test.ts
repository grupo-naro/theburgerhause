import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { ORDER_STATUSES, type OrderStatus } from "@/domain/order-status";
import { makeCadet, orderEventsOf, orderRow, preparingCounterOrder, preparingWebOrder } from "@/test-support/dispatch";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { markDelivered, markPickup, markReady, returnToDispatch } from "./dispatch";

const db = () => testDb();
let fx: Fx;

const ready = (orderId: number) => markReady(db(), { orderId, userId: fx.userId });
const pickup = (orderId: number) => markPickup(db(), { orderId, userId: fx.userId });
const deliver = (orderId: number, collected?: boolean) => markDelivered(db(), { orderId, userId: fx.userId, collected });
const back = (orderId: number, reason = "No atendieron") => returnToDispatch(db(), { orderId, userId: fx.userId, reason });
const setStatus = (id: number, status: OrderStatus) => db().update(s.orders).set({ status }).where(eq(s.orders.id, id));

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("happy flows", () => {
  it("web delivery: markReady, then (assigned elsewhere) markDelivered keeps cash pending", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "delivery", paymentMethod: "cash" });
    expect(await ready(o.id)).toMatchObject({ ok: true });
    expect((await orderRow(o.id)).status).toBe("listo_despacho");
    const cadet = await makeCadet();
    await db().update(s.orders).set({ status: "en_camino", cadetId: cadet.id }).where(eq(s.orders.id, o.id));
    const at = new Date("2026-10-15T15:00:00Z");
    expect(await markDelivered(db(), { orderId: o.id, userId: fx.userId }, { now: at })).toMatchObject({ ok: true });
    const row = await orderRow(o.id);
    expect(row).toMatchObject({ status: "entregado", paymentStatus: "pending", cadetId: cadet.id });
    expect(row.deliveredAt).toEqual(at);
  });

  it("delivery with transfer stays paid; `collected` is irrelevant for delivery", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "delivery", paymentMethod: "transfer" });
    await ready(o.id);
    await db().update(s.orders).set({ status: "en_camino" }).where(eq(s.orders.id, o.id));
    expect(await deliver(o.id, true)).toMatchObject({ ok: true });
    expect(await orderRow(o.id)).toMatchObject({ status: "entregado", paymentStatus: "paid" });
  });

  it("delivery cash with collected=true does NOT mark it paid (rendicion does)", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "delivery", paymentMethod: "cash" });
    await ready(o.id);
    await db().update(s.orders).set({ status: "en_camino" }).where(eq(s.orders.id, o.id));
    expect(await deliver(o.id, true)).toMatchObject({ ok: true });
    expect(await orderRow(o.id)).toMatchObject({ status: "entregado", paymentStatus: "pending" });
  });

  it("takeaway cash: needs collected=true; without it nothing changes", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "takeaway", paymentMethod: "cash" });
    expect(await ready(o.id)).toMatchObject({ ok: true });
    expect(await pickup(o.id)).toMatchObject({ ok: true });
    expect((await orderRow(o.id)).status).toBe("para_retirar");
    const before = (await orderEventsOf(o.id)).length;

    const refused = await deliver(o.id);
    expect(refused).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(!refused.ok && refused.message).toMatch(/Confirmá que cobraste \$/);
    expect(await deliver(o.id, false)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await orderRow(o.id)).toMatchObject({ status: "para_retirar", paymentStatus: "pending", deliveredAt: null });
    expect(await orderEventsOf(o.id)).toHaveLength(before);

    expect(await deliver(o.id, true)).toMatchObject({ ok: true, data: { status: "entregado", paymentStatus: "paid" } });
    const row = await orderRow(o.id);
    expect(row).toMatchObject({ status: "entregado", paymentStatus: "paid" });
    expect(row.deliveredAt).not.toBeNull();
  });

  it("takeaway already paid (transfer) never needs collection", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "takeaway", paymentMethod: "transfer" });
    await ready(o.id);
    await pickup(o.id);
    expect(await deliver(o.id)).toMatchObject({ ok: true });
    expect(await orderRow(o.id)).toMatchObject({ status: "entregado", paymentStatus: "paid" });
  });

  it("counter sale: ready, pickup, delivered without collection (born paid)", async () => {
    const o = await preparingCounterOrder(fx);
    expect(await ready(o.id)).toMatchObject({ ok: true });
    expect(await pickup(o.id)).toMatchObject({ ok: true });
    expect(await deliver(o.id)).toMatchObject({ ok: true });
    expect(await orderRow(o.id)).toMatchObject({ status: "entregado", paymentStatus: "paid" });
    expect((await orderEventsOf(o.id)).map((e) => e.toStatus)).toEqual([
      "en_preparacion",
      "listo_despacho",
      "para_retirar",
      "entregado",
    ]);
  });

  it("results carry order number and the new state", async () => {
    const o = await preparingWebOrder(fx);
    expect(await ready(o.id)).toEqual({
      ok: true,
      data: { orderId: o.id, number: o.number, status: "listo_despacho", paymentStatus: "pending" },
    });
  });

  it("events record the acting user", async () => {
    const o = await preparingWebOrder(fx);
    await markReady(db(), { orderId: o.id, userId: fx.otherUserId });
    expect((await orderEventsOf(o.id)).at(-1)).toMatchObject({
      fromStatus: "en_preparacion",
      toStatus: "listo_despacho",
      userId: fx.otherUserId,
    });
  });
});

describe("markPickup restrictions", () => {
  it("delivery orders go out with a cadet", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
    await ready(o.id);
    const r = await pickup(o.id);
    expect(r).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(!r.ok && r.message).toContain(`#${o.number}`);
    expect(!r.ok && r.message).toMatch(/cadete/);
    expect((await orderRow(o.id)).status).toBe("listo_despacho");
  });
});

describe("illegal source states", () => {
  const ops: [string, (id: number) => Promise<{ ok: boolean }>, OrderStatus[], "delivery" | "takeaway"][] = [
    ["markReady", ready, ["en_preparacion"], "delivery"],
    ["markPickup", pickup, ["listo_despacho"], "takeaway"],
    ["markDelivered (takeaway)", (id) => deliver(id, true), ["para_retirar"], "takeaway"],
    ["markDelivered (delivery)", (id) => deliver(id), ["en_camino"], "delivery"],
    ["returnToDispatch", back, ["en_camino"], "delivery"],
  ];
  for (const [name, run, legal, fulfillment] of ops) {
    for (const status of ORDER_STATUSES.filter((st) => !legal.includes(st))) {
      it(`${name} from ${status} -> INVALID_TRANSITION, no change, no event`, async () => {
        const o = await placeWebOrder(fx, { fulfillment });
        await setStatus(o.id, status);
        const before = await orderEventsOf(o.id);
        const r = await run(o.id);
        expect(r).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
        expect((r as unknown as { message: string }).message).toContain(`#${o.number}`);
        expect((await orderRow(o.id)).status).toBe(status);
        expect(await orderEventsOf(o.id)).toHaveLength(before.length);
      });
    }
  }

  it("the message names the order and its current state", async () => {
    const o = await placeWebOrder(fx);
    const r = await ready(o.id);
    expect(r).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(!r.ok && r.message).toBe(`El pedido #${o.number} está pendiente de aprobación; no se puede marcar como listo.`);
  });
});

describe("returnToDispatch", () => {
  it("clears the cadet, stores the reason and requires one", async () => {
    const o = await preparingWebOrder(fx);
    await ready(o.id);
    const cadet = await makeCadet();
    await db().update(s.orders).set({ status: "en_camino", cadetId: cadet.id }).where(eq(s.orders.id, o.id));

    for (const reason of ["", "  ", "ab", "x".repeat(201)]) {
      expect(await back(o.id, reason)).toMatchObject({ ok: false, code: "VALIDATION" });
    }
    expect(await orderRow(o.id)).toMatchObject({ status: "en_camino", cadetId: cadet.id });

    expect(await back(o.id, "  Nadie atendió  ")).toMatchObject({ ok: true, data: { status: "listo_despacho" } });
    expect(await orderRow(o.id)).toMatchObject({ status: "listo_despacho", cadetId: null });
    expect((await orderEventsOf(o.id)).at(-1)).toMatchObject({
      fromStatus: "en_camino",
      toStatus: "listo_despacho",
      note: "Nadie atendió",
    });
  });
});

describe("input validation and unknown orders", () => {
  it("unknown order -> NOT_FOUND; bad ids -> VALIDATION", async () => {
    expect(await ready(31337)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await pickup(31337)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await deliver(31337)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await back(31337)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await ready(-1)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await markReady(db(), { orderId: 1, userId: 0 })).toMatchObject({ ok: false, code: "VALIDATION" });
  });
});
