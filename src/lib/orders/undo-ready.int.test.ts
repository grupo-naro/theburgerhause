import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { makeCadet, orderEventsOf, orderRow, preparingCounterOrder, preparingWebOrder } from "@/test-support/dispatch";
import { seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { markPickup, markReady } from "./dispatch";
import { UNDO_READY_NOTE, undoReady } from "./undo-ready";

const db = () => testDb();
let fx: Fx;
const ready = (orderId: number) => markReady(db(), { sector: null, orderId, userId: fx.userId });
const undo = (orderId: number, sector: "mostrador" | "delivery" | null = null) => undoReady(db(), { sector, orderId, userId: fx.userId });

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("undoReady", () => {
  it.each(["delivery", "takeaway"] as const)("%s: listo_despacho -> en_preparacion, with an audit event and nothing else cleared", async (fulfillment) => {
    const o = await preparingWebOrder(fx, { fulfillment });
    await ready(o.id);
    const before = await orderRow(o.id);
    const r = await undo(o.id);
    expect(r).toMatchObject({ ok: true, data: { orderId: o.id, number: o.number, status: "en_preparacion" } });
    expect(await orderRow(o.id)).toEqual({ ...before, status: "en_preparacion" });
    const ev = await orderEventsOf(o.id);
    expect(ev.at(-1)).toMatchObject({ fromStatus: "listo_despacho", toStatus: "en_preparacion", userId: fx.userId, note: UNDO_READY_NOTE });
    expect(ev).toHaveLength(4); // created, approved, ready, undo
  });

  it("a counter sale keeps its pager through ready -> undo -> ready", async () => {
    const o = await preparingCounterOrder(fx, { pagerNumber: 9 });
    await ready(o.id);
    expect(await undo(o.id)).toMatchObject({ ok: true });
    expect(await orderRow(o.id)).toMatchObject({ status: "en_preparacion", pagerNumber: 9 });
    expect(await ready(o.id)).toMatchObject({ ok: true });
  });

  it("is refused once the pager was called (para_retirar), with a message that says why", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    await ready(o.id);
    await markPickup(db(), { sector: null, orderId: o.id, userId: fx.userId });
    const r = await undo(o.id);
    expect(r).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(r.ok ? "" : r.message).toMatch(/avisad/i);
    expect((await orderRow(o.id)).status).toBe("para_retirar");
  });

  it("is refused when en_camino, entregado, cancelado or still en_preparacion; nothing is written", async () => {
    const cadet = await makeCadet();
    for (const status of ["en_camino", "entregado", "cancelado", "en_preparacion"] as const) {
      const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
      await db()
        .update(s.orders)
        .set({ status, ...(status === "en_camino" ? { cadetId: cadet.id } : {}) })
        .where(eq(s.orders.id, o.id));
      const events = (await orderEventsOf(o.id)).length;
      expect(await undo(o.id), status).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
      expect(await orderEventsOf(o.id)).toHaveLength(events);
      expect((await orderRow(o.id)).status).toBe(status);
    }
  });

  it("is refused when a cadet is already assigned, even if the status looks ready", async () => {
    const cadet = await makeCadet();
    const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
    await ready(o.id);
    await db().update(s.orders).set({ cadetId: cadet.id }).where(eq(s.orders.id, o.id));
    expect(await undo(o.id)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect((await orderRow(o.id)).status).toBe("listo_despacho");
  });

  it("unknown order and invalid input", async () => {
    expect(await undo(999_999)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await undoReady(db(), { sector: null, orderId: -1, userId: fx.userId })).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("applies the sector rule it is given (the kitchen role passes null)", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
    await ready(o.id);
    expect(await undo(o.id, "mostrador")).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await undo(o.id, "delivery")).toMatchObject({ ok: true });
  });

  it("two concurrent undos: exactly one transition and one event", async () => {
    const o = await preparingWebOrder(fx);
    await ready(o.id);
    const [a, b] = await Promise.all([undo(o.id), undo(o.id)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect((await orderEventsOf(o.id)).filter((e) => e.toStatus === "en_preparacion")).toHaveLength(2); // approval + one undo
  });
});
