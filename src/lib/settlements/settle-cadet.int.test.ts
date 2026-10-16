import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { Client } from "pg";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { cadetBalance, type BalanceOrder } from "@/domain/cadet-balance";
import { formatARS } from "@/domain/money";
import { setCadetActive } from "@/lib/cadets/admin";
import { getEnv } from "@/lib/env";
import { assignCadet, markDelivered, markReady } from "@/lib/orders/dispatch";
import { makeCadet, orderEventsOf, orderRow, preparingWebOrder } from "@/test-support/dispatch";
import { seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { deliveredCounter, deliveredOrder, deliveredTakeaway, enRouteOrder, sumTotals } from "@/test-support/settlements";
import { settleCadet } from "./settle-cadet";

const db = () => testDb();
let fx: Fx;

const settle = (cadetId: number, expectedAmount: number, note?: string, userId = fx.userId) =>
  settleCadet(db(), { cadetId, expectedAmount, userId, ...(note === undefined ? {} : { note }) });

async function dropFailureTriggers() {
  await db().execute(sql.raw("DROP FUNCTION IF EXISTS boom_settle() CASCADE;"));
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

const snapshot = async () =>
  JSON.stringify({
    orders: await db().select().from(s.orders).orderBy(s.orders.id),
    events: await db().select().from(s.orderEvents).orderBy(s.orderEvents.id),
    settlements: await db().select().from(s.settlements),
    so: await db().select().from(s.settlementOrders),
  });
const balanceOf = async (cadetId: number) => {
  const rows = await db().select().from(s.orders);
  return cadetBalance(rows as BalanceOrder[], cadetId);
};

describe("settleCadet: happy path", () => {
  it("settles exactly the delivered cash orders and leaves everything else untouched", async () => {
    const cadet = await makeCadet("Nahuel");
    const a = await deliveredOrder(fx, cadet.id, { units: "one" });
    const b = await deliveredOrder(fx, cadet.id, { units: "two" });
    const c = await deliveredOrder(fx, cadet.id, { units: "melt" });
    const transfer = await deliveredOrder(fx, cadet.id, { paymentMethod: "transfer" });
    const route = await enRouteOrder(fx, cadet.id, { units: "two" });
    const owed = await sumTotals([a.id, b.id, c.id]);
    expect(await balanceOf(cadet.id)).toMatchObject({ owed, inRoute: 1 });
    const beforeOthers = JSON.stringify([await orderRow(transfer.id), await orderRow(route.id)]);

    const r = await settle(cadet.id, owed, "  Todo ok  ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ amount: owed, orderCount: 3, cadet: { id: cadet.id, name: "Nahuel" } });
    expect(r.data.orders.map((o) => o.id)).toEqual([a.id, b.id, c.id]);
    expect(r.data.orders.map((o) => o.number)).toEqual([a.number, b.number, c.number]);
    expect(r.data.orders.reduce((x, o) => x + o.total, 0)).toBe(owed);

    const [st] = await db().select().from(s.settlements);
    expect(st).toMatchObject({ id: r.data.settlementId, cadetId: cadet.id, amount: owed, settledBy: fx.userId, note: "Todo ok" });
    const so = await db().select().from(s.settlementOrders).orderBy(s.settlementOrders.orderId);
    expect(so).toHaveLength(3);
    for (const row of so) expect(row).toMatchObject({ settlementId: st.id, amount: await sumTotals([row.orderId]) });
    for (const o of [a, b, c]) {
      expect(await orderRow(o.id)).toMatchObject({ status: "entregado", paymentStatus: "paid", cadetId: cadet.id });
      expect((await orderEventsOf(o.id)).at(-1)).toMatchObject({
        fromStatus: "entregado",
        toStatus: "entregado",
        userId: fx.userId,
        note: `Rendición #${st.id}`,
      });
    }
    expect(JSON.stringify([await orderRow(transfer.id), await orderRow(route.id)])).toBe(beforeOthers);
    expect(await orderRow(route.id)).toMatchObject({ status: "en_camino", paymentStatus: "pending" });
    expect(await balanceOf(cadet.id)).toEqual({ owed: 0, orderIds: [], inRoute: 1 });
  });

  it("a later settlement covers only what was delivered afterwards", async () => {
    const cadet = await makeCadet();
    const a = await deliveredOrder(fx, cadet.id);
    expect(await settle(cadet.id, await sumTotals([a.id]))).toMatchObject({ ok: true });
    const b = await enRouteOrder(fx, cadet.id, { units: "two" });
    expect(await settle(cadet.id, await sumTotals([b.id]))).toMatchObject({ ok: false, code: "NOTHING_TO_SETTLE" });
    await markDelivered(db(), { orderId: b.id, userId: fx.userId });
    const r = await settle(cadet.id, await sumTotals([b.id]));
    expect(r).toMatchObject({ ok: true, data: { orderCount: 1, amount: await sumTotals([b.id]) } });
    expect(await db().select().from(s.settlements)).toHaveLength(2);
    expect(await db().select().from(s.settlementOrders)).toHaveLength(2);
  });

  it("the note is optional and stored as NULL when blank", async () => {
    const cadet = await makeCadet();
    const a = await deliveredOrder(fx, cadet.id);
    const b = await deliveredOrder(fx, cadet.id);
    expect(await settle(cadet.id, await sumTotals([a.id, b.id]), "   ")).toMatchObject({ ok: true });
    expect((await db().select().from(s.settlements))[0].note).toBeNull();
  });

  it("an INACTIVE cadet with debt can still be settled", async () => {
    const cadet = await makeCadet("Retirado");
    const a = await deliveredOrder(fx, cadet.id);
    expect(await setCadetActive(db(), cadet.id, false)).toMatchObject({ ok: true });
    expect(await settle(cadet.id, await sumTotals([a.id]))).toMatchObject({ ok: true, data: { cadet: { name: "Retirado" } } });
    expect((await orderRow(a.id)).paymentStatus).toBe("paid");
  });

  it("settles a large batch (200 orders) in one transaction with the exact sum", async () => {
    const cadet = await makeCadet();
    const rows = Array.from({ length: 200 }, (_, i) => ({
      businessDate: "2026-10-14",
      number: 200000 + i,
      publicToken: `bulk-${i}`,
      channel: "web" as const,
      fulfillment: "delivery" as const,
      status: "entregado" as const,
      paymentMethod: "cash" as const,
      paymentStatus: "pending" as const,
      customerName: "Cliente",
      subtotal: 1234_50 + i * 7,
      deliveryFee: 0,
      total: 1234_50 + i * 7,
      cadetId: cadet.id,
    }));
    const inserted = await db().insert(s.orders).values(rows).returning({ id: s.orders.id });
    const expected = rows.reduce((a, r) => a + r.total, 0);
    const r = await settle(cadet.id, expected);
    expect(r).toMatchObject({ ok: true, data: { amount: expected, orderCount: 200 } });
    if (!r.ok) return;
    expect(await db().select().from(s.settlementOrders)).toHaveLength(200);
    const paid = await db().select({ id: s.orders.id }).from(s.orders).where(eq(s.orders.paymentStatus, "paid"));
    expect(new Set(paid.map((p) => p.id))).toEqual(new Set(inserted.map((p) => p.id)));
    const evs = await db().select().from(s.orderEvents).where(eq(s.orderEvents.note, `Rendición #${r.data.settlementId}`));
    expect(evs).toHaveLength(200);
  });
});

describe("settleCadet: orders that are never included", () => {
  it("takeaway, counter, cancelled, already-paid and other cadets' orders", async () => {
    const cadet = await makeCadet("Mine");
    const other = await makeCadet("Other");
    const mine = await deliveredOrder(fx, cadet.id);
    await deliveredTakeaway(fx);
    await deliveredCounter(fx, 5);
    const othersOrder = await deliveredOrder(fx, other.id);
    const paidAlready = await deliveredOrder(fx, cadet.id, { units: "two" });
    await db().update(s.orders).set({ paymentStatus: "paid" }).where(eq(s.orders.id, paidAlready.id));
    const cancelled = await deliveredOrder(fx, cadet.id, { units: "melt" });
    await db().update(s.orders).set({ status: "cancelado" }).where(eq(s.orders.id, cancelled.id));

    const owed = await sumTotals([mine.id]);
    const r = await settle(cadet.id, owed);
    expect(r).toMatchObject({ ok: true, data: { orderCount: 1, amount: owed } });
    expect((await orderRow(othersOrder.id)).paymentStatus).toBe("pending");
    expect((await orderRow(cancelled.id)).status).toBe("cancelado");
    expect((await db().select().from(s.settlementOrders)).map((x) => x.orderId)).toEqual([mine.id]);
  });
});

describe("settleCadet: refusals write nothing", () => {
  it("wrong expectedAmount (higher and lower) -> AMOUNT_MISMATCH with the real figures", async () => {
    const cadet = await makeCadet("Nahuel");
    const a = await deliveredOrder(fx, cadet.id);
    const b = await deliveredOrder(fx, cadet.id, { units: "two" });
    const actual = await sumTotals([a.id, b.id]);
    const before = await snapshot();
    for (const expected of [actual + 1, actual - 1, 1]) {
      const r = await settle(cadet.id, expected, "nota");
      expect(r).toMatchObject({ ok: false, code: "AMOUNT_MISMATCH", details: { expected, actual, orderCount: 2 } });
      if (r.ok) return;
      expect(r.message).toContain("Nahuel");
      expect(r.message).toContain(formatARS(actual));
      expect(r.message).toContain(formatARS(expected));
      expect(await snapshot()).toBe(before);
    }
  });

  it("no pending cash -> NOTHING_TO_SETTLE (even with only en_camino and transfer orders)", async () => {
    const cadet = await makeCadet("Nahuel");
    await enRouteOrder(fx, cadet.id);
    await deliveredOrder(fx, cadet.id, { paymentMethod: "transfer" });
    const before = await snapshot();
    const r = await settle(cadet.id, 100);
    expect(r).toMatchObject({ ok: false, code: "NOTHING_TO_SETTLE" });
    expect(!r.ok && r.message).toContain("Nahuel");
    expect(!r.ok && r.message).toContain("no tiene efectivo pendiente de rendir");
    expect(await snapshot()).toBe(before);
  });

  it("unknown cadet -> CADET_NOT_FOUND; bad input -> VALIDATION", async () => {
    expect(await settle(4242, 100)).toMatchObject({ ok: false, code: "CADET_NOT_FOUND" });
    const cadet = await makeCadet();
    for (const bad of [0, -5, 1.5, 2_147_483_648]) expect(await settle(cadet.id, bad)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await settle(cadet.id, 100, "x".repeat(201))).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await settle(cadet.id, 100, undefined, 0)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await db().select().from(s.settlements)).toHaveLength(0);
  });

  it("an order already linked to a settlement hits the unique index and is reported, not thrown", async () => {
    const cadet = await makeCadet("Nahuel");
    const a = await deliveredOrder(fx, cadet.id);
    // Inconsistent legacy data: the order is still pending but already has a settlement row.
    const [old] = await db().insert(s.settlements).values({ cadetId: cadet.id, amount: 1 }).returning();
    await db().insert(s.settlementOrders).values({ settlementId: old.id, orderId: a.id, amount: 1 });
    const before = await snapshot();
    const r = await settle(cadet.id, await sumTotals([a.id]));
    expect(r).toMatchObject({ ok: false, code: "NOTHING_TO_SETTLE" });
    expect(JSON.stringify(r)).not.toMatch(/settlement_orders|duplicate|23505/);
    expect(await snapshot()).toBe(before);
  });

  it("the unique index on settlement_orders(order_id) rejects a direct double insert", async () => {
    const cadet = await makeCadet();
    const a = await deliveredOrder(fx, cadet.id);
    const [s1, s2] = await db().insert(s.settlements).values([{ cadetId: cadet.id, amount: 5 }, { cadetId: cadet.id, amount: 5 }]).returning();
    await db().insert(s.settlementOrders).values({ settlementId: s1.id, orderId: a.id, amount: 5 });
    await expect(db().insert(s.settlementOrders).values({ settlementId: s2.id, orderId: a.id, amount: 5 })).rejects.toMatchObject({
      cause: { code: "23505" },
    });
  });
});

describe("settleCadet: concurrency (Review Focus 5)", () => {
  it("5 parallel settlements of the same cadet: exactly one wins, the cash is counted once", async () => {
    for (let round = 0; round < 3; round++) {
      const cadet = await makeCadet(`Racer ${round}`);
      const orders = [await deliveredOrder(fx, cadet.id), await deliveredOrder(fx, cadet.id, { units: "two" }), await deliveredOrder(fx, cadet.id, { units: "melt" })];
      const ids = orders.map((o) => o.id);
      const owed = await sumTotals(ids);
      const results = await Promise.all(Array.from({ length: 5 }, (_, i) => settle(cadet.id, owed, `pc ${i}`, i % 2 ? fx.userId : fx.otherUserId)));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      for (const r of results) if (!r.ok) expect(["NOTHING_TO_SETTLE", "AMOUNT_MISMATCH"]).toContain(r.code);
      const sts = await db().select().from(s.settlements).where(eq(s.settlements.cadetId, cadet.id));
      expect(sts).toHaveLength(1);
      expect(sts[0].amount).toBe(owed);
      const so = await db().select().from(s.settlementOrders).where(inArray(s.settlementOrders.orderId, ids));
      expect(so).toHaveLength(3);
      expect(so.every((x) => x.settlementId === sts[0].id)).toBe(true);
      for (const id of ids) {
        expect((await orderRow(id)).paymentStatus).toBe("paid");
        expect((await orderEventsOf(id)).filter((e) => e.note?.startsWith("Rendición"))).toHaveLength(1);
      }
    }
  });

  it("different amounts racing: still exactly one settlement", async () => {
    const cadet = await makeCadet();
    const a = await deliveredOrder(fx, cadet.id);
    const owed = await sumTotals([a.id]);
    const results = await Promise.all([settle(cadet.id, owed), settle(cadet.id, owed + 100), settle(cadet.id, owed), settle(cadet.id, 7)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await db().select().from(s.settlements)).toHaveLength(1);
  });

  it("settlement vs markDelivered of another order of the same cadet (10 rounds): never half-settled", async () => {
    for (let round = 0; round < 10; round++) {
      const cadet = await makeCadet(`Round ${round}`);
      const base = [await deliveredOrder(fx, cadet.id), await deliveredOrder(fx, cadet.id, { units: "two" })];
      const late = await enRouteOrder(fx, cadet.id, { units: "melt" });
      const owed = await sumTotals(base.map((o) => o.id));
      const [r, d] = await Promise.all([settle(cadet.id, owed), markDelivered(db(), { orderId: late.id, userId: fx.userId })]);
      expect(d.ok).toBe(true);
      expect(r.ok || r.code === "AMOUNT_MISMATCH").toBe(true);

      // each settlement amount equals the sum of its lines; a settled order is paid exactly once.
      const sts = await db().select().from(s.settlements).where(eq(s.settlements.cadetId, cadet.id));
      expect(sts).toHaveLength(r.ok ? 1 : 0);
      for (const st of sts) {
        const lines = await db().select().from(s.settlementOrders).where(eq(s.settlementOrders.settlementId, st.id));
        expect(lines.reduce((a, l) => a + l.amount, 0)).toBe(st.amount);
        for (const l of lines) expect((await orderRow(l.orderId)).paymentStatus).toBe("paid");
      }
      expect(await orderRow(late.id)).toMatchObject({ status: "entregado", paymentStatus: "pending" });
      // whatever was left over is collectible by the next settlement
      const bal = await balanceOf(cadet.id);
      expect(bal.owed).toBe(r.ok ? await sumTotals([late.id]) : owed + (await sumTotals([late.id])));
      expect(await settle(cadet.id, bal.owed)).toMatchObject({ ok: true });
      expect((await balanceOf(cadet.id)).owed).toBe(0);
    }
  });

  it("settlement vs assignCadet for the same cadet serializes on the cadet lock (no deadlock)", async () => {
    for (let round = 0; round < 10; round++) {
      const cadet = await makeCadet(`Asg ${round}`);
      const a = await deliveredOrder(fx, cadet.id);
      const ready = await preparingWebOrder(fx, { fulfillment: "delivery" });
      await markReady(db(), { orderId: ready.id, userId: fx.userId });
      const [r, asg] = await Promise.all([
        settle(cadet.id, await sumTotals([a.id])),
        assignCadet(db(), { orderIds: [ready.id], cadetId: cadet.id, userId: fx.userId }),
      ]);
      expect(r).toMatchObject({ ok: true });
      expect(asg).toMatchObject({ ok: true });
      expect(await orderRow(ready.id)).toMatchObject({ status: "en_camino", paymentStatus: "pending" });
      expect((await orderRow(a.id)).paymentStatus).toBe("paid");
    }
  });
});

describe("settleCadet: notifications and rollback", () => {
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

  it("after commit: one `settled` event per order; refusals emit nothing", async () => {
    const cadet = await makeCadet();
    const os = [await deliveredOrder(fx, cadet.id), await deliveredOrder(fx, cadet.id, { units: "two" })];
    const owed = await sumTotals(os.map((o) => o.id));
    const { client, received } = await listen();
    try {
      received.length = 0;
      expect(await settle(cadet.id, owed + 1)).toMatchObject({ ok: false });
      await waitFor(() => received.length > 0, 300);
      expect(received).toEqual([]);
      expect(await settle(cadet.id, owed)).toMatchObject({ ok: true });
      await waitFor(() => received.length >= 2);
      await waitFor(() => received.length > 2, 150);
      expect(received.map((r) => r.payload)).toEqual(os.map((o) => ({ orderId: o.id, status: "entregado", event: "settled" })));
    } finally {
      await client.end();
    }
  });

  it("a commit that FAILS after the notifies rolls everything back and emits nothing", async () => {
    const cadet = await makeCadet();
    const os = [await deliveredOrder(fx, cadet.id), await deliveredOrder(fx, cadet.id, { units: "two" })];
    const owed = await sumTotals(os.map((o) => o.id));
    const before = await snapshot();
    const { client, received } = await listen();
    try {
      received.length = 0;
      await db().execute(
        sql.raw(`
          CREATE FUNCTION boom_settle() RETURNS trigger AS $$ BEGIN
            IF NEW.note LIKE 'Rendición%' THEN RAISE EXCEPTION 'boom at commit'; END IF;
            RETURN NULL;
          END $$ LANGUAGE plpgsql;
          CREATE CONSTRAINT TRIGGER boom_settle_trg AFTER INSERT ON order_events
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION boom_settle();`),
      );
      const r = await settle(cadet.id, owed);
      expect(r).toMatchObject({ ok: false, code: "UNEXPECTED" });
      expect(JSON.stringify(r)).not.toContain("boom");
      await waitFor(() => received.length > 0, 600);
      expect(received).toEqual([]);
      expect(await snapshot()).toBe(before);

      await dropFailureTriggers();
      expect(await settle(cadet.id, owed)).toMatchObject({ ok: true });
      await waitFor(() => received.length >= 2);
      expect(received).toHaveLength(2);
    } finally {
      await client.end();
    }
  });
});
