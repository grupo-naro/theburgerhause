import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { getEnv } from "@/lib/env";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { approveOrder } from "./approve-order";
import { rejectOrder } from "./reject-order";
import { reprintOrder } from "./reprint";

const db = () => testDb();
let fx: Fx;

const reprint = (orderId: number, which: unknown, over: Partial<Parameters<typeof reprintOrder>[1]> = {}) =>
  reprintOrder(db(), { orderId, userId: fx.otherUserId, stationId: fx.otherStationId, which: which as "both", sector: null, ...over });
const approved = async () => {
  const o = await placeWebOrder(fx, { paymentMethod: "transfer" });
  await approveOrder(db(), { sector: null, orderId: o.id, userId: fx.userId, stationId: fx.stationId, paymentVerified: true });
  return o;
};
const jobs = (orderId: number) =>
  db().select().from(s.printJobs).where(eq(s.printJobs.orderId, orderId)).orderBy(s.printJobs.id);
const events = (orderId: number) =>
  db().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, orderId)).orderBy(s.orderEvents.id);

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("reprintOrder", () => {
  it("both: 2 NEW jobs for the CURRENT station, payload re-rendered, event written", async () => {
    const o = await approved();
    const r = await reprint(o.id, "both");
    if (!r.ok) throw new Error(r.message);
    const all = await jobs(o.id);
    expect(all).toHaveLength(4);
    const fresh = all.slice(2);
    expect(fresh.map((j) => j.id)).toEqual(r.data.printJobIds);
    expect(fresh.map((j) => j.type)).toEqual(["kitchen", "ticket"]);
    for (const j of fresh) expect(j).toMatchObject({ stationId: fx.otherStationId, status: "pending", attempts: 0 });
    expect(fresh[0].payload).toEqual(all[0].payload);
    expect(fresh[1].payload).toEqual(all[1].payload);
    expect(all.slice(0, 2).every((j) => j.stationId === fx.stationId)).toBe(true); // originals untouched
    const evs = await events(o.id);
    expect(evs.at(-1)).toMatchObject({
      fromStatus: "en_preparacion",
      toStatus: "en_preparacion",
      userId: fx.otherUserId,
      note: "Reimpresión (both)",
    });
  });

  it("kitchen / ticket create exactly one job of that type", async () => {
    const o = await approved();
    await reprint(o.id, "kitchen");
    await reprint(o.id, "ticket");
    expect((await jobs(o.id)).slice(2).map((j) => j.type)).toEqual(["kitchen", "ticket"]);
    expect((await events(o.id)).slice(-2).map((e) => e.note)).toEqual(["Reimpresión (kitchen)", "Reimpresión (ticket)"]);
  });

  it("works for later states too, but not for pending or cancelled orders", async () => {
    const delivered = await approved();
    await db().update(s.orders).set({ status: "entregado" }).where(eq(s.orders.id, delivered.id));
    expect(await reprint(delivered.id, "both")).toMatchObject({ ok: true });

    const pending = await placeWebOrder(fx);
    expect(await reprint(pending.id, "both")).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    const cancelled = await placeWebOrder(fx);
    await rejectOrder(db(), { sector: null, orderId: cancelled.id, userId: fx.userId, reason: "motivo" });
    expect(await reprint(cancelled.id, "both")).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(await jobs(pending.id)).toHaveLength(0);
    expect(await jobs(cancelled.id)).toHaveLength(0);
  });

  it("STATION_REQUIRED without or with unknown station; nothing written", async () => {
    const o = await approved();
    for (const stationId of [null, 424242]) {
      expect(await reprint(o.id, "both", { stationId })).toEqual({
        ok: false,
        code: "STATION_REQUIRED",
        message: "Elegí tu estación para imprimir",
      });
    }
    expect(await jobs(o.id)).toHaveLength(2);
    expect(await events(o.id)).toHaveLength(2);
  });

  it("unknown order, bad which and bad ids are refused", async () => {
    const o = await approved();
    expect(await reprint(99999, "both")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    for (const which of ["all", "", null, undefined, 3]) {
      expect(await reprint(o.id, which)).toMatchObject({ ok: false, code: "VALIDATION" });
    }
    expect(await reprint(-1, "both")).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await jobs(o.id)).toHaveLength(2);
  });

  it("notifies PRINT per job and ORDERS {event: updated} after commit", async () => {
    const o = await approved();
    const client = new Client({ connectionString: getEnv().DATABASE_URL });
    await client.connect();
    await client.query("LISTEN orders_changed");
    await client.query("LISTEN print_job_created");
    const got: { channel: string; payload: unknown }[] = [];
    client.on("notification", (n) => got.push({ channel: n.channel, payload: JSON.parse(n.payload ?? "null") }));
    try {
      const r = await reprint(o.id, "both");
      if (!r.ok) throw new Error(r.message);
      const end = Date.now() + 3000;
      while (got.length < 3 && Date.now() < end) await new Promise((res) => setTimeout(res, 25));
      expect(got.filter((g) => g.channel === "orders_changed").map((g) => g.payload)).toEqual([
        { orderId: o.id, status: "en_preparacion", event: "updated" },
      ]);
      expect(got.filter((g) => g.channel === "print_job_created").map((g) => g.payload)).toEqual(
        r.data.printJobIds.map((jobId) => ({ jobId, stationId: fx.otherStationId })),
      );
    } finally {
      await client.end();
    }
  });
});
