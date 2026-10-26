import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { preparingWebOrder } from "@/test-support/dispatch";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { countInPreparation, loadEstimateInputs, loadPrepSamples } from "./queries";

const db = () => testDb();
const NOW = new Date("2026-10-15T20:00:00Z");
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000);
let fx: Fx;

type Status = (typeof s.orderEvents.$inferInsert)["toStatus"];
async function events(orderId: number, rows: [Status | null, Status, number][]) {
  await db().delete(s.orderEvents).where(eq(s.orderEvents.orderId, orderId));
  await db().insert(s.orderEvents).values(rows.map(([f, t, m]) => ({ orderId, fromStatus: f, toStatus: t, at: at(m) })));
}

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("loadPrepSamples", () => {
  it("measures preparation to ready, delivery and takeaway", async () => {
    const a = await placeWebOrder(fx);
    const b = await placeWebOrder(fx, { fulfillment: "takeaway" });
    await events(a.id, [["pendiente_aprobacion", "en_preparacion", 50], ["en_preparacion", "listo_despacho", 30]]);
    await events(b.id, [["pendiente_aprobacion", "en_preparacion", 40], ["en_preparacion", "para_retirar", 25]]);
    expect((await loadPrepSamples(db(), NOW)).sort((x, y) => x - y)).toEqual([15, 20]);
  });

  it("ignores tanda events (from = to) between start and ready", async () => {
    const a = await placeWebOrder(fx);
    await events(a.id, [
      ["pendiente_aprobacion", "en_preparacion", 60],
      ["en_preparacion", "en_preparacion", 40],
      ["en_preparacion", "listo_despacho", 20],
    ]);
    expect(await loadPrepSamples(db(), NOW)).toEqual([40]);
  });

  it("excludes orders ready more than 180 minutes ago", async () => {
    const old = await placeWebOrder(fx);
    const recent = await placeWebOrder(fx);
    await events(old.id, [["pendiente_aprobacion", "en_preparacion", 220], ["en_preparacion", "listo_despacho", 200]]);
    await events(recent.id, [["pendiente_aprobacion", "en_preparacion", 30], ["en_preparacion", "listo_despacho", 10]]);
    expect(await loadPrepSamples(db(), NOW)).toEqual([20]);
  });

  it("gives no sample for an order still in preparation", async () => {
    const a = await placeWebOrder(fx);
    await events(a.id, [["pendiente_aprobacion", "en_preparacion", 30]]);
    expect(await loadPrepSamples(db(), NOW)).toEqual([]);
  });

  it("keeps only the newest 20", async () => {
    for (let i = 0; i < 22; i++) {
      const o = await placeWebOrder(fx);
      await events(o.id, [["pendiente_aprobacion", "en_preparacion", 100 - i * 2], ["en_preparacion", "listo_despacho", 90 - i * 2]]);
    }
    expect(await loadPrepSamples(db(), NOW)).toHaveLength(20);
  });
});

describe("loadPrepSamples on a large history", () => {
  it("ignores thousands of old orders and stays fast", async () => {
    const a = await placeWebOrder(fx);
    await events(a.id, [["pendiente_aprobacion", "en_preparacion", 50], ["en_preparacion", "listo_despacho", 30]]);
    await db().execute(sql`
      INSERT INTO orders (business_date, number, public_token, channel, fulfillment, status, payment_method, payment_status,
                          customer_name, subtotal, delivery_fee, total, created_at)
      SELECT '2020-01-01', 1000 + g, 'old' || g, 'web', 'takeaway', 'entregado', 'cash', 'paid', 'Old', 0, 0, 0, ${at(60 * 24 * 30)}::timestamptz
      FROM generate_series(1, 3000) g`);
    await db().execute(sql`
      INSERT INTO order_events (order_id, from_status, to_status, at)
      SELECT o.id, 'pendiente_aprobacion'::order_status, 'en_preparacion'::order_status, ${at(60 * 24 * 30)}::timestamptz FROM orders o WHERE o.public_token LIKE 'old%'
      UNION ALL
      SELECT o.id, 'en_preparacion'::order_status, 'listo_despacho'::order_status, ${at(60 * 24 * 30 - 20)}::timestamptz FROM orders o WHERE o.public_token LIKE 'old%'`);
    const t0 = performance.now();
    const samples = await loadPrepSamples(db(), NOW);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(samples).toEqual([20]);
  });
});

describe("countInPreparation", () => {
  it("counts only en_preparacion", async () => {
    await placeWebOrder(fx); // pendiente_aprobacion
    await preparingWebOrder(fx, { fulfillment: "delivery" });
    await preparingWebOrder(fx, { fulfillment: "takeaway" });
    const ready = await preparingWebOrder(fx, { fulfillment: "delivery" });
    await db().update(s.orders).set({ status: "listo_despacho" }).where(eq(s.orders.id, ready.id));
    expect(await countInPreparation(db())).toBe(2);
    expect(await loadEstimateInputs(db(), NOW)).toEqual({ samplesMinutes: [], inPreparation: 2 });
  });
});
