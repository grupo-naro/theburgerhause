import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { getEnv } from "@/lib/env";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { approveOrder } from "./approve-order";
import { listFailedPrintJobs, listPendingApproval, listRecentProcessed } from "./caja-queries";
import { rejectOrder } from "./reject-order";

const db = () => testDb();
let fx: Fx;

const setCreatedAt = (id: number, iso: string) =>
  db().update(s.orders).set({ createdAt: new Date(iso) }).where(eq(s.orders.id, id));
const approve = (orderId: number) =>
  approveOrder(db(), { sector: null, orderId, userId: fx.userId, stationId: fx.otherStationId, paymentVerified: true });

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("listPendingApproval", () => {
  it("returns only pending orders, oldest first, with the staff DTO", async () => {
    const newer = await placeWebOrder(fx, { paymentMethod: "transfer" });
    const older = await placeWebOrder(fx, { fulfillment: "takeaway" });
    const approved = await placeWebOrder(fx);
    await approve(approved.id);
    await setCreatedAt(older.id, "2026-10-14T20:00:00Z");
    await setCreatedAt(newer.id, "2026-10-14T20:10:00Z");

    const now = new Date("2026-10-14T20:25:30Z");
    const list = await listPendingApproval(db(), { now });
    expect(list.map((o) => o.id)).toEqual([older.id, newer.id]);

    const [, full] = list;
    expect(full).toMatchObject({
      id: newer.id,
      number: newer.number,
      channel: "web",
      fulfillment: "delivery",
      status: "pendiente_aprobacion",
      paymentMethod: "transfer",
      paymentStatus: "pending",
      customerName: "Juana Pérez",
      whatsapp: expect.stringContaining("5491155551234"),
      address: "Av. Siempreviva 742",
      crossStreets: "Mitre y Sarmiento",
      addressNotes: "timbre roto",
      pagerNumber: null,
      createdAt: "2026-10-14T20:10:00.000Z",
      minutesWaiting: 15,
      printState: { pending: 0, failed: 0, done: 0 },
    });
    expect(list[0].minutesWaiting).toBe(25);
    expect(list[0].address).toBeNull();
    expect(list[0].subtotal + list[0].deliveryFee).toBe(list[0].total);
  });

  it("groups identical units and exposes modifier names + kitchen labels", async () => {
    const o = await placeWebOrder(fx, {
      fulfillment: "takeaway",
      units: [
        { productId: fx.ranchita, modifierIds: [fx.dips, fx.sinCheddar], note: "bien cocida" },
        { productId: fx.ranchita, modifierIds: [fx.dips, fx.sinCheddar], note: "bien cocida" },
        { productId: fx.melt, modifierIds: [], note: "" },
      ],
    });
    const [dto] = await listPendingApproval(db());
    expect(dto.id).toBe(o.id);
    expect(dto.items).toHaveLength(2);
    expect(dto.items[0]).toMatchObject({ name: "Ranchita simple", quantity: 2, note: "bien cocida" });
    expect(dto.items[0].modifiers).toEqual(
      expect.arrayContaining([
        { name: "Dips", priceDelta: 1200_00, kitchenLabel: "+ DIPS" },
        { name: "Sin cheddar", priceDelta: 0, kitchenLabel: "SIN CHEDDAR" },
      ]),
    );
    expect(dto.items[1]).toMatchObject({ name: "Melt simple", quantity: 1, modifiers: [] });
  });

  it("never reports negative waiting minutes", async () => {
    await placeWebOrder(fx);
    const [dto] = await listPendingApproval(db(), { now: new Date("2000-01-01T00:00:00Z") });
    expect(dto.minutesWaiting).toBe(0);
  });

  it("empty database -> []", async () => {
    await resetDb();
    expect(await listPendingApproval(db())).toEqual([]);
    expect(await listRecentProcessed(db(), { limit: 5 })).toEqual([]);
    expect(await listFailedPrintJobs(db())).toEqual([]);
  });
});

describe("listRecentProcessed", () => {
  it("excludes pending, newest first, honours the limit, clamps nonsense limits", async () => {
    const pending = await placeWebOrder(fx);
    const a = await placeWebOrder(fx);
    const b = await placeWebOrder(fx);
    const c = await placeWebOrder(fx);
    await approve(a.id);
    await approve(b.id);
    await rejectOrder(db(), { sector: null, orderId: c.id, userId: fx.userId, reason: "sin stock" });
    await setCreatedAt(a.id, "2026-10-14T20:00:00Z");
    await setCreatedAt(b.id, "2026-10-14T20:05:00Z");
    await setCreatedAt(c.id, "2026-10-14T20:10:00Z");

    const all = await listRecentProcessed(db(), { limit: 10 });
    expect(all.map((o) => o.id)).toEqual([c.id, b.id, a.id]);
    expect(all.map((o) => o.id)).not.toContain(pending.id);
    expect(all.map((o) => o.status)).toEqual(["cancelado", "en_preparacion", "en_preparacion"]);
    expect((await listRecentProcessed(db(), { limit: 2 })).map((o) => o.id)).toEqual([c.id, b.id]);
    expect(await listRecentProcessed(db(), { limit: 0 })).toHaveLength(1);
    expect(await listRecentProcessed(db(), { limit: Number.NaN })).toHaveLength(3);
  });
});

describe("print state aggregation", () => {
  it("counts pending(+printing) / failed / done jobs per order", async () => {
    const o1 = await placeWebOrder(fx);
    const o2 = await placeWebOrder(fx);
    await approve(o1.id);
    await approve(o2.id);
    const j = await db().select().from(s.printJobs).where(eq(s.printJobs.orderId, o1.id)).orderBy(s.printJobs.id);
    await db().update(s.printJobs).set({ status: "done" }).where(eq(s.printJobs.id, j[0].id));
    await db().update(s.printJobs).set({ status: "failed", error: "sin papel" }).where(eq(s.printJobs.id, j[1].id));
    await db().insert(s.printJobs).values({
      orderId: o1.id,
      stationId: fx.otherStationId,
      type: "customer",
      payload: {},
      status: "printing",
    });

    const list = await listRecentProcessed(db(), { limit: 10 });
    const byId = new Map(list.map((o) => [o.id, o.printState]));
    expect(byId.get(o1.id)).toEqual({ pending: 1, failed: 1, done: 1 });
    expect(byId.get(o2.id)).toEqual({ pending: 2, failed: 0, done: 0 });
  });
});

describe("listFailedPrintJobs", () => {
  it("lists failed jobs with order number, type, error and attempts; filters by station", async () => {
    const o = await placeWebOrder(fx);
    await approve(o.id);
    const jobs = await db().select().from(s.printJobs).orderBy(s.printJobs.id);
    await db().update(s.printJobs).set({ status: "failed", error: "sin papel", attempts: 3 }).where(eq(s.printJobs.id, jobs[0].id));
    await db()
      .update(s.printJobs)
      .set({ status: "failed", error: "offline", attempts: 1, stationId: fx.stationId })
      .where(eq(s.printJobs.id, jobs[1].id));

    const all = await listFailedPrintJobs(db());
    expect(all).toHaveLength(2);
    expect(all.find((f) => f.jobId === jobs[0].id)).toMatchObject({
      orderId: o.id,
      orderNumber: o.number,
      type: "customer",
      error: "sin papel",
      attempts: 3,
      stationId: fx.otherStationId,
    });
    expect((await listFailedPrintJobs(db(), fx.otherStationId)).map((f) => f.jobId)).toEqual([jobs[0].id]);
    expect((await listFailedPrintJobs(db(), fx.stationId)).map((f) => f.jobId)).toEqual([jobs[1].id]);
  });
});

describe("failed jobs that were handled (superseded)", () => {
  const failJob = (id: number) =>
    db().update(s.printJobs).set({ status: "failed", error: "sin papel", attempts: 3 }).where(eq(s.printJobs.id, id));
  const newJob = (orderId: number, type: "delivery" | "customer", stationId: number, status: "pending" | "printing" | "done" | "failed") =>
    db().insert(s.printJobs).values({ orderId, stationId, type, payload: {}, status }).returning();

  it("a later pending/printing/done job of the same type and station handles the failure", async () => {
    for (const status of ["pending", "printing", "done"] as const) {
      await resetDb();
      fx = await seedMenuAndStaff();
      const o = await placeWebOrder(fx);
      await approve(o.id);
      const [kitchen] = await db().select().from(s.printJobs).where(eq(s.printJobs.type, "delivery"));
      await failJob(kitchen.id);
      expect(await listFailedPrintJobs(db(), fx.otherStationId)).toHaveLength(1);
      await newJob(o.id, "delivery", fx.otherStationId, status);
      expect(await listFailedPrintJobs(db(), fx.otherStationId)).toEqual([]);
      const [row] = await listRecentProcessed(db());
      expect(row.printState.failed).toBe(0);
    }
  });

  it("legacy failed 'kitchen'/'ticket' jobs are handled by a later delivery/customer job (their successors)", async () => {
    const o = await placeWebOrder(fx);
    await approve(o.id);
    const legacy = (type: "kitchen" | "ticket") =>
      db().insert(s.printJobs).values({ orderId: o.id, stationId: fx.otherStationId, type, payload: {}, status: "failed", error: "sin papel", attempts: 3 }).returning();
    const [kitchen] = await legacy("kitchen");
    const [ticket] = await legacy("ticket");
    expect((await listFailedPrintJobs(db(), fx.otherStationId)).map((f) => f.jobId).sort()).toEqual([kitchen.id, ticket.id].sort());
    await newJob(o.id, "customer", fx.otherStationId, "done"); // clears the legacy ticket only
    expect((await listFailedPrintJobs(db(), fx.otherStationId)).map((f) => f.jobId)).toEqual([kitchen.id]);
    await newJob(o.id, "delivery", fx.otherStationId, "pending"); // and now the legacy kitchen one
    expect(await listFailedPrintJobs(db(), fx.otherStationId)).toEqual([]);
    const [row] = await listRecentProcessed(db());
    expect(row.printState.failed).toBe(0);
  });

  it("a different type, a different station or a later FAILED job do not handle it", async () => {
    const o = await placeWebOrder(fx);
    await approve(o.id);
    const [kitchen] = await db().select().from(s.printJobs).where(eq(s.printJobs.type, "delivery"));
    await failJob(kitchen.id);
    await newJob(o.id, "customer", fx.otherStationId, "done");
    await newJob(o.id, "delivery", fx.stationId, "done");
    expect((await listFailedPrintJobs(db(), fx.otherStationId)).map((f) => f.jobId)).toEqual([kitchen.id]);
    await newJob(o.id, "delivery", fx.otherStationId, "failed");
    expect(await listFailedPrintJobs(db(), fx.otherStationId)).toHaveLength(2);
    const [row] = await listRecentProcessed(db());
    expect(row.printState.failed).toBe(2);
  });
});

describe("query count", () => {
  it("is constant regardless of the number of orders (no N+1)", async () => {
    for (let i = 0; i < 6; i++) {
      const o = await placeWebOrder(fx);
      if (i % 2 === 0) await approve(o.id);
    }
    const statements: string[] = [];
    const pool = new Pool({ connectionString: getEnv().DATABASE_URL });
    const spy = drizzle(pool, { logger: { logQuery: (q) => void statements.push(q) } });
    try {
      await listPendingApproval(spy);
      const pendingQueries = statements.length;
      statements.length = 0;
      await listRecentProcessed(spy, { limit: 50 });
      const recentQueries = statements.length;
      statements.length = 0;
      await listFailedPrintJobs(spy);
      expect(pendingQueries).toBeLessThanOrEqual(3);
      expect(recentQueries).toBeLessThanOrEqual(3);
      expect(statements.length).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
