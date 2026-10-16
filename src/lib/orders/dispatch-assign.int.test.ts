import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { Client } from "pg";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { setCadetActive } from "@/lib/cadets/admin";
import { getEnv } from "@/lib/env";
import { makeCadet, orderEventsOf, orderRow, preparingWebOrder } from "@/test-support/dispatch";
import { seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { assignCadet, markReady, returnToDispatch } from "./dispatch";

const db = () => testDb();
let fx: Fx;

const assign = (orderIds: number[], cadetId: number, userId = fx.userId) => assignCadet(db(), { sector: null, orderIds, cadetId, userId });
const readyDelivery = async (paymentMethod: "cash" | "transfer" = "cash", fulfillment: "delivery" | "takeaway" = "delivery") => {
  const o = await preparingWebOrder(fx, { fulfillment, paymentMethod });
  const r = await markReady(db(), { sector: null, orderId: o.id, userId: fx.userId });
  if (!r.ok) throw new Error(r.message);
  return o;
};
const snapshot = async (ids: number[]) => {
  const rows = await db().select().from(s.orders).where(inArray(s.orders.id, ids)).orderBy(s.orders.id);
  const evs = await db().select().from(s.orderEvents).where(inArray(s.orderEvents.orderId, ids)).orderBy(s.orderEvents.id);
  return JSON.stringify({ rows, evs });
};

async function dropFailureTriggers() {
  await db().execute(sql.raw("DROP FUNCTION IF EXISTS boom_assign() CASCADE;"));
}

beforeEach(async () => {
  await dropFailureTriggers();
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterEach(dropFailureTriggers);
afterAll(async () => {
  await dropFailureTriggers();
  await closeDb();
});

describe("assignCadet: success", () => {
  it("assigns several orders atomically, one event each, with the cash to collect", async () => {
    const a = await readyDelivery("cash");
    const b = await readyDelivery("transfer");
    const c = await readyDelivery("cash");
    const cadet = await makeCadet("Nahuel");
    const r = await assign([c.id, a.id, b.id], cadet.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const totalOf = async (id: number) => (await orderRow(id)).total;
    expect(r.data.cadet).toEqual({ id: cadet.id, name: "Nahuel" });
    expect(r.data.count).toBe(3);
    expect(r.data.orders.map((o) => o.number)).toEqual([a.number, b.number, c.number]);
    expect(r.data.orders.find((o) => o.id === b.id)).toMatchObject({ paymentMethod: "transfer", paymentStatus: "paid" });
    expect(r.data.cashToCollect).toBe((await totalOf(a.id)) + (await totalOf(c.id)));
    for (const o of [a, b, c]) {
      expect(await orderRow(o.id)).toMatchObject({ status: "en_camino", cadetId: cadet.id });
      const evs = await orderEventsOf(o.id);
      expect(evs.at(-1)).toMatchObject({
        fromStatus: "listo_despacho",
        toStatus: "en_camino",
        userId: fx.userId,
        note: "Asignado a Nahuel",
      });
      expect(evs.filter((e) => e.toStatus === "en_camino")).toHaveLength(1);
    }
  });

  it("duplicate ids are de-duplicated", async () => {
    const a = await readyDelivery();
    const cadet = await makeCadet();
    const r = await assign([a.id, a.id, a.id], cadet.id);
    expect(r).toMatchObject({ ok: true, data: { count: 1 } });
    expect((await orderEventsOf(a.id)).filter((e) => e.toStatus === "en_camino")).toHaveLength(1);
  });

  it("returnToDispatch clears the cadet and the order can go to another cadet", async () => {
    const a = await readyDelivery();
    const c1 = await makeCadet("Uno");
    const c2 = await makeCadet("Dos");
    await assign([a.id], c1.id);
    expect(await returnToDispatch(db(), { sector: null, orderId: a.id, userId: fx.userId, reason: "Nadie atendió" })).toMatchObject({ ok: true });
    expect((await orderRow(a.id)).cadetId).toBeNull();
    expect(await assign([a.id], c2.id)).toMatchObject({ ok: true });
    expect(await orderRow(a.id)).toMatchObject({ status: "en_camino", cadetId: c2.id });
  });
});

describe("assignCadet: refusals change nothing", () => {
  it("one invalid order sinks the batch and every offender is listed", async () => {
    const good = await readyDelivery();
    const takeaway = await readyDelivery("cash", "takeaway");
    const notReady = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const already = await readyDelivery();
    const other = await makeCadet("Otro");
    await assign([already.id], other.id);
    const cadet = await makeCadet("Nahuel");
    const ids = [good.id, takeaway.id, notReady.id, already.id, 99999];
    const before = await snapshot(ids);

    const r = await assign(ids, cadet.id);
    expect(r).toMatchObject({ ok: false, code: "NOT_FOUND" });
    if (r.ok) return;
    expect(r.details).toEqual([
      { orderId: takeaway.id, orderNumber: takeaway.number, reason: expect.stringContaining("retirar") },
      { orderId: notReady.id, orderNumber: notReady.number, reason: expect.stringContaining("en preparación") },
      { orderId: already.id, orderNumber: already.number, reason: expect.stringContaining("en camino") },
      { orderId: 99999, orderNumber: null, reason: "El pedido no existe" },
    ]);
    expect(await snapshot(ids)).toBe(before);
  });

  it("codes: takeaway -> NOT_DELIVERY, wrong state -> INVALID_TRANSITION naming order and state", async () => {
    const cadet = await makeCadet();
    const takeaway = await readyDelivery("cash", "takeaway");
    const r1 = await assign([takeaway.id], cadet.id);
    expect(r1).toMatchObject({ ok: false, code: "NOT_DELIVERY" });
    expect(!r1.ok && r1.message).toContain(`#${takeaway.number}`);

    const notReady = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const r2 = await assign([notReady.id], cadet.id);
    expect(r2).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(!r2.ok && r2.message).toContain(`#${notReady.number}`);
    expect(!r2.ok && r2.message).toContain("en preparación");
  });

  it("an inactive cadet is refused by name, nothing changes", async () => {
    const a = await readyDelivery();
    const cadet = await makeCadet("Dormido", { active: false });
    const before = await snapshot([a.id]);
    const r = await assign([a.id], cadet.id);
    expect(r).toMatchObject({ ok: false, code: "CADET_INACTIVE" });
    expect(!r.ok && r.message).toContain("Dormido");
    expect(await snapshot([a.id])).toBe(before);
  });

  it("unknown cadet -> CADET_NOT_FOUND", async () => {
    const a = await readyDelivery();
    expect(await assign([a.id], 4242)).toMatchObject({ ok: false, code: "CADET_NOT_FOUND" });
    expect((await orderRow(a.id)).status).toBe("listo_despacho");
  });

  it("input bounds: 0, 51 ids, bad ids -> VALIDATION", async () => {
    const cadet = await makeCadet();
    expect(await assign([], cadet.id)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await assign(Array.from({ length: 51 }, (_, i) => i + 1), cadet.id)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await assign([0], cadet.id)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await assign([1], -1)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await assign([1], cadet.id, 0)).toMatchObject({ ok: false, code: "VALIDATION" });
  });
});

describe("assignCadet: concurrency", () => {
  it("cadet deactivation vs assignment (10 rounds): never an inactive cadet with orders sent after deactivation", async () => {
    const outcomes = { assigned: 0, deactivated: 0 };
    for (let round = 0; round < 10; round++) {
      const a = await readyDelivery();
      const b = await readyDelivery();
      const cadet = await makeCadet(`Cadete ${round}`);
      const [deact, asg] = await Promise.all([setCadetActive(db(), cadet.id, false), assign([a.id, b.id], cadet.id)]);

      const [row] = await db().select().from(s.cadets).where(eq(s.cadets.id, cadet.id));
      const enCamino = (await db().select().from(s.orders).where(eq(s.orders.cadetId, cadet.id))).filter((o) => o.status === "en_camino");
      if (asg.ok) {
        outcomes.assigned++;
        expect(deact).toMatchObject({ ok: false });
        expect(row.active).toBe(true);
        expect(enCamino).toHaveLength(2);
      } else {
        outcomes.deactivated++;
        expect(asg).toMatchObject({ ok: false, code: "CADET_INACTIVE" });
        expect(deact).toMatchObject({ ok: true });
        expect(row.active).toBe(false);
        expect(enCamino).toHaveLength(0);
      }
      expect(!(row.active === false && enCamino.length > 0)).toBe(true);
    }
    expect(outcomes.assigned + outcomes.deactivated).toBe(10);
  });

  it("the same order to two cadets at once: exactly one wins, the other INVALID_TRANSITION", async () => {
    for (let round = 0; round < 5; round++) {
      const a = await readyDelivery();
      const c1 = await makeCadet(`A${round}`);
      const c2 = await makeCadet(`B${round}`);
      const [r1, r2] = await Promise.all([assign([a.id], c1.id), assign([a.id], c2.id)]);
      expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
      const loser = r1.ok ? r2 : r1;
      expect(loser).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
      const row = await orderRow(a.id);
      expect(row.cadetId).toBe(r1.ok ? c1.id : c2.id);
      expect((await orderEventsOf(a.id)).filter((e) => e.toStatus === "en_camino")).toHaveLength(1);
    }
  });

  it("overlapping batches listed in opposite orders never deadlock", async () => {
    for (let round = 0; round < 5; round++) {
      const os = [await readyDelivery(), await readyDelivery(), await readyDelivery(), await readyDelivery()];
      const c1 = await makeCadet(`X${round}`);
      const c2 = await makeCadet(`Y${round}`);
      const ids = os.map((o) => o.id);
      const [r1, r2] = await Promise.all([assign(ids, c1.id), assign([...ids].reverse(), c2.id)]);
      expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
      const winner = r1.ok ? c1.id : c2.id;
      for (const id of ids) expect(await orderRow(id)).toMatchObject({ status: "en_camino", cadetId: winner });
    }
  });

  it("partially overlapping batches: all-or-nothing for each, no half-applied assignment", async () => {
    const os = [await readyDelivery(), await readyDelivery(), await readyDelivery(), await readyDelivery()];
    const c1 = await makeCadet("P");
    const c2 = await makeCadet("Q");
    const [r1, r2] = await Promise.all([
      assign([os[0].id, os[1].id, os[2].id], c1.id),
      assign([os[3].id, os[2].id, os[1].id], c2.id),
    ]);
    expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
    const rows = await db().select().from(s.orders).orderBy(s.orders.id);
    const count = (id: number) => rows.filter((o) => o.cadetId === id).length;
    expect(r1.ok ? [count(c1.id), count(c2.id)] : [count(c1.id), count(c2.id)]).toEqual(r1.ok ? [3, 0] : [0, 3]);
  });
});

describe("assignCadet: notifications", () => {
  async function listen() {
    const client = new Client({ connectionString: getEnv().DATABASE_URL });
    await client.connect();
    await client.query("LISTEN orders_changed");
    const received: { channel: string; payload: unknown }[] = [];
    client.on("notification", (n) => received.push({ channel: n.channel, payload: JSON.parse(n.payload ?? "null") }));
    return { client, received };
  }
  const waitFor = async (pred: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  };

  it("after commit: exactly one `assigned` event per order", async () => {
    const os = [await readyDelivery(), await readyDelivery()];
    const cadet = await makeCadet();
    const { client, received } = await listen();
    try {
      received.length = 0;
      expect(await assign(os.map((o) => o.id), cadet.id)).toMatchObject({ ok: true });
      await waitFor(() => received.length >= 2);
      await waitFor(() => received.length > 2, 150);
      expect(received.map((r) => r.payload)).toEqual(
        os.map((o) => ({ orderId: o.id, status: "en_camino", event: "assigned" })),
      );
    } finally {
      await client.end();
    }
  });

  it("simple operations emit one `status` event each; refused ones emit nothing", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "takeaway", paymentMethod: "transfer" });
    const { client, received } = await listen();
    try {
      received.length = 0;
      await markReady(db(), { sector: null, orderId: o.id, userId: fx.userId });
      await markReady(db(), { sector: null, orderId: o.id, userId: fx.userId }); // refused
      await waitFor(() => received.length >= 1);
      await waitFor(() => received.length > 1, 150);
      expect(received.map((r) => r.payload)).toEqual([{ orderId: o.id, status: "listo_despacho", event: "status" }]);
    } finally {
      await client.end();
    }
  });

  it("refused assignments emit nothing", async () => {
    const takeaway = await readyDelivery("cash", "takeaway");
    const cadet = await makeCadet();
    const { client, received } = await listen();
    try {
      received.length = 0;
      await assign([takeaway.id], cadet.id);
      await waitFor(() => received.length > 0, 400);
      expect(received).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it("a commit that FAILS after the notifies rolls back statuses, cadets and events and emits nothing", async () => {
    const os = [await readyDelivery(), await readyDelivery(), await readyDelivery()];
    const ids = os.map((o) => o.id);
    const cadet = await makeCadet();
    const before = await snapshot(ids);
    const { client, received } = await listen();
    try {
      received.length = 0;
      await db().execute(
        sql.raw(`
          CREATE FUNCTION boom_assign() RETURNS trigger AS $$ BEGIN
            IF NEW.to_status = 'en_camino' THEN RAISE EXCEPTION 'boom at commit'; END IF;
            RETURN NULL;
          END $$ LANGUAGE plpgsql;
          CREATE CONSTRAINT TRIGGER boom_assign_trg AFTER INSERT ON order_events
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION boom_assign();`),
      );
      const r = await assign(ids, cadet.id);
      expect(r).toMatchObject({ ok: false, code: "UNEXPECTED" });
      expect(JSON.stringify(r)).not.toContain("boom");
      await waitFor(() => received.length > 0, 600);
      expect(received).toEqual([]);
      expect(await snapshot(ids)).toBe(before);

      await dropFailureTriggers();
      expect(await assign(ids, cadet.id)).toMatchObject({ ok: true });
      await waitFor(() => received.length >= 3);
      expect(received).toHaveLength(3);
    } finally {
      await client.end();
    }
  });
});
