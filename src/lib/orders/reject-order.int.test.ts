import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { approveOrder } from "./approve-order";
import { rejectOrder } from "./reject-order";

const db = () => testDb();
let fx: Fx;

const reject = (orderId: number, reason: string, over: Partial<Parameters<typeof rejectOrder>[1]> = {}) =>
  rejectOrder(db(), { orderId, userId: fx.userId, reason, sector: null, ...over });
const approve = (orderId: number) =>
  approveOrder(db(), { sector: null, orderId, userId: fx.userId, stationId: fx.stationId, paymentVerified: true });
const order = async (id: number) => (await db().select().from(s.orders).where(eq(s.orders.id, id)))[0];
const jobs = () => db().select().from(s.printJobs);
const events = (orderId: number) =>
  db().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, orderId)).orderBy(s.orderEvents.id);

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("rejectOrder", () => {
  it("cancels with the reason as the event note and creates no print jobs", async () => {
    const o = await placeWebOrder(fx);
    expect(await reject(o.id, "  Sin stock de pan  ")).toEqual({ ok: true, data: { orderId: o.id, status: "cancelado" } });
    expect((await order(o.id)).status).toBe("cancelado");
    const evs = await events(o.id);
    expect(evs[1]).toMatchObject({
      fromStatus: "pendiente_aprobacion",
      toStatus: "cancelado",
      userId: fx.userId,
      note: "Sin stock de pan",
    });
    expect(await jobs()).toHaveLength(0);
  });

  it.each(["", "   ", "ab", "x".repeat(201)])("invalid reason %j -> VALIDATION, order untouched", async (reason) => {
    const o = await placeWebOrder(fx);
    expect(await reject(o.id, reason)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect((await order(o.id)).status).toBe("pendiente_aprobacion");
    expect(await events(o.id)).toHaveLength(1);
  });

  it("strips control characters from the stored reason", async () => {
    const o = await placeWebOrder(fx);
    await reject(o.id, "Sin\u0000 stock‮\nhoy");
    expect((await events(o.id))[1].note).toBe("Sin stock hoy");
  });

  it("unknown order -> NOT_FOUND; bad ids -> VALIDATION", async () => {
    expect(await reject(31337, "motivo")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await reject(-3, "motivo")).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await reject(1, "motivo", { userId: 0 })).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("an approved order cannot be rejected", async () => {
    const o = await placeWebOrder(fx);
    await approve(o.id);
    expect(await reject(o.id, "tarde")).toEqual({
      ok: false,
      code: "INVALID_TRANSITION",
      message: "Este pedido ya está en preparación",
    });
    expect((await order(o.id)).status).toBe("en_preparacion");
  });

  it("a rejected order can be neither rejected again nor approved", async () => {
    const o = await placeWebOrder(fx);
    await reject(o.id, "motivo uno");
    expect(await reject(o.id, "motivo dos")).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(await approve(o.id)).toEqual({ ok: false, code: "INVALID_TRANSITION", message: "Este pedido fue cancelado" });
    expect(await jobs()).toHaveLength(0);
    expect((await events(o.id)).filter((e) => e.toStatus === "cancelado")).toHaveLength(1);
  });

  it("parallel approve vs reject: exactly one wins and the final state is consistent", async () => {
    for (let round = 0; round < 6; round++) {
      await resetDb();
      fx = await seedMenuAndStaff();
      const o = await placeWebOrder(fx);
      const [a, r] = await Promise.all([approve(o.id), reject(o.id, "cliente cancelo")]);
      expect([a.ok, r.ok].filter(Boolean)).toHaveLength(1);
      const row = await order(o.id);
      const js = await jobs();
      if (a.ok) {
        expect(row.status).toBe("en_preparacion");
        expect(js).toHaveLength(2);
        expect(r).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
      } else {
        expect(row.status).toBe("cancelado");
        expect(js).toHaveLength(0);
        expect(a).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
      }
      expect(await events(o.id)).toHaveLength(2);
    }
  });
});
