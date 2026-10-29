import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { approveOrder } from "./approve-order";
import { listFailedPrintJobs } from "./caja-queries";
import { enqueueAddonPrintJobs, loadPrintableOrder } from "./print-jobs";

const db = () => testDb();
let fx: Fx;

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

const jobsOf = (orderId: number) => db().select().from(s.printJobs).where(eq(s.printJobs.orderId, orderId)).orderBy(s.printJobs.id);

/** An approved order plus a confirmed add-on of one "Melt simple" (note "extra") inserted straight into the tables. */
async function orderWithAddon(fulfillment: "delivery" | "takeaway", seq = 1) {
  const o = await placeWebOrder(fx, { fulfillment });
  await approveOrder(db(), { sector: null, orderId: o.id, userId: fx.userId, stationId: fx.otherStationId, paymentVerified: true });
  const [addon] = await db()
    .insert(s.orderAddons)
    .values({ orderId: o.id, seq, status: "confirmado", units: [], subtotal: 8800_00 })
    .returning();
  await db().insert(s.orderItems).values({ orderId: o.id, productId: fx.melt, nameSnapshot: "Melt simple", unitPriceSnapshot: 8800_00, notes: "extra", addonId: addon.id });
  return { o, addon };
}

describe("loadPrintableOrder / enqueueAddonPrintJobs", () => {
  it("loadPrintableOrder fills addonSeq; with addonId it only returns that add-on's items", async () => {
    const { o, addon } = await orderWithAddon("takeaway", 3);
    const full = await db().transaction((tx) => loadPrintableOrder(tx, o.id));
    expect(full!.items).toHaveLength(4);
    expect(full!.items.map((i) => i.addonSeq)).toEqual([null, null, null, 3]);
    const only = await db().transaction((tx) => loadPrintableOrder(tx, o.id, { addonId: addon.id }));
    expect(only!.items).toMatchObject([{ name: "Melt simple", note: "extra", addonSeq: 3 }]);
  });

  it("enqueueAddonPrintJobs crea un job additional con los ítems del adicional", async () => {
    const { o, addon } = await orderWithAddon("takeaway", 2);
    const before = await jobsOf(o.id);
    const ids = await db().transaction((tx) => enqueueAddonPrintJobs(tx, { orderId: o.id, addonId: addon.id, seq: 2, stationId: fx.otherStationId }));
    const fresh = (await jobsOf(o.id)).slice(before.length);
    expect(fresh.map((j) => j.id)).toEqual(ids);
    expect(fresh.map((j) => j.type)).toEqual(["additional"]);
    expect(fresh[0]).toMatchObject({ stationId: fx.otherStationId, status: "pending", attempts: 0 });
    const json = JSON.stringify(fresh[0].payload);
    expect(json).toContain(`ADICIONAL 2 al #${o.number}`);
    expect(json).toContain("MELT SIMPLE");
    expect(json).not.toContain("RANCHITA");
  });

  it("re-encola el ticket de delivery para pedidos web de delivery y no para retiro", async () => {
    const d = await orderWithAddon("delivery");
    const dBefore = (await jobsOf(d.o.id)).length;
    await db().transaction((tx) => enqueueAddonPrintJobs(tx, { orderId: d.o.id, addonId: d.addon.id, seq: 1, stationId: fx.otherStationId }));
    const dFresh = (await jobsOf(d.o.id)).slice(dBefore);
    expect(dFresh.map((j) => j.type)).toEqual(["additional", "delivery"]);
    expect(JSON.stringify(dFresh[1].payload)).toContain("Melt simple"); // full order incl. the add-on

    const t = await orderWithAddon("takeaway");
    const tBefore = (await jobsOf(t.o.id)).length;
    await db().transaction((tx) => enqueueAddonPrintJobs(tx, { orderId: t.o.id, addonId: t.addon.id, seq: 1, stationId: fx.otherStationId }));
    expect((await jobsOf(t.o.id)).slice(tBefore).map((j) => j.type)).toEqual(["additional"]);
  });

  it("un job additional fallido aparece en listFailedPrintJobs y no se oculta por otro adicional reimpreso", async () => {
    const { o, addon } = await orderWithAddon("takeaway", 1);
    const [first] = await db().transaction((tx) => enqueueAddonPrintJobs(tx, { orderId: o.id, addonId: addon.id, seq: 1, stationId: fx.otherStationId }));
    await db().update(s.printJobs).set({ status: "failed", error: "sin papel", attempts: 3 }).where(eq(s.printJobs.id, first));
    expect(await listFailedPrintJobs(db(), fx.otherStationId)).toMatchObject([{ jobId: first, type: "additional", addonSeq: 1 }]);

    const [addon2] = await db().insert(s.orderAddons).values({ orderId: o.id, seq: 2, status: "confirmado", units: [], subtotal: 1 }).returning();
    await db().transaction((tx) => enqueueAddonPrintJobs(tx, { orderId: o.id, addonId: addon2.id, seq: 2, stationId: fx.otherStationId }));
    expect((await listFailedPrintJobs(db(), fx.otherStationId)).map((f) => f.jobId)).toEqual([first]); // add-on 2 does not hide add-on 1

    await db().transaction((tx) => enqueueAddonPrintJobs(tx, { orderId: o.id, addonId: addon.id, seq: 1, stationId: fx.otherStationId }));
    expect(await listFailedPrintJobs(db(), fx.otherStationId)).toEqual([]); // reprint of the SAME add-on handles it
  });

  it("no re-encola el delivery en una estación mostrador (misma regla que defaultPrintKinds)", async () => {
    const { o, addon } = await orderWithAddon("delivery");
    const before = (await jobsOf(o.id)).length;
    await db().transaction((tx) => enqueueAddonPrintJobs(tx, { orderId: o.id, addonId: addon.id, seq: 1, stationId: fx.stationId }));
    expect((await jobsOf(o.id)).slice(before).map((j) => j.type)).toEqual(["additional"]);
  });
});
