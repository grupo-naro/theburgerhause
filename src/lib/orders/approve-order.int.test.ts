import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { formatARS } from "@/domain/money";
import { renderCustomerTicket, renderDeliveryTicket } from "@/domain/print-document";
import { getEnv } from "@/lib/env";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { approveOrder } from "./approve-order";
import { orderToPrintable } from "./printable";

const db = () => testDb();
let fx: Fx;

const approve = (orderId: number, over: Partial<Parameters<typeof approveOrder>[1]> = {}) =>
  approveOrder(db(), { orderId, userId: fx.userId, stationId: fx.otherStationId /* Delivery station: the default order is a delivery */, paymentVerified: false, sector: null, ...over });
const order = async (id: number) => (await db().select().from(s.orders).where(eq(s.orders.id, id)))[0];
const jobs = (orderId?: number) =>
  orderId
    ? db().select().from(s.printJobs).where(eq(s.printJobs.orderId, orderId)).orderBy(s.printJobs.id)
    : db().select().from(s.printJobs);
const events = (orderId: number) =>
  db().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, orderId)).orderBy(s.orderEvents.id);

async function dropFailureTriggers() {
  await db().execute(sql.raw("DROP FUNCTION IF EXISTS boom_commit() CASCADE;"));
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

describe("approveOrder: payment rules and state", () => {
  it("cash: en_preparacion, stays pending, approval columns set", async () => {
    const o = await placeWebOrder(fx, { paymentMethod: "cash" });
    const r = await approve(o.id);
    expect(r).toMatchObject({
      ok: true,
      data: { orderId: o.id, number: o.number, status: "en_preparacion", paymentStatus: "pending" },
    });
    const row = await order(o.id);
    expect(row).toMatchObject({
      status: "en_preparacion",
      paymentStatus: "pending",
      approvedBy: fx.userId,
      stationId: fx.otherStationId,
    });
    expect(row.approvedAt).toBeInstanceOf(Date);
  });

  it("transfer verified: paid", async () => {
    const o = await placeWebOrder(fx, { paymentMethod: "transfer", fulfillment: "takeaway" });
    const r = await approve(o.id, { paymentVerified: true });
    expect(r).toMatchObject({ ok: true, data: { paymentStatus: "paid" } });
    expect((await order(o.id)).paymentStatus).toBe("paid");
  });

  it("transfer WITHOUT paymentVerified: VALIDATION and nothing changes", async () => {
    const o = await placeWebOrder(fx, { paymentMethod: "transfer" });
    const before = await order(o.id);
    const r = await approve(o.id, { paymentVerified: false });
    expect(r).toEqual({ ok: false, code: "VALIDATION", message: "Confirmá que verificaste la acreditación del pago" });
    expect(await order(o.id)).toEqual(before);
    expect(await jobs()).toHaveLength(0);
    expect((await events(o.id)).map((e) => e.toStatus)).toEqual(["pendiente_aprobacion"]);
  });

  it("writes the order event with the user and no note", async () => {
    const o = await placeWebOrder(fx);
    await approve(o.id);
    const evs = await events(o.id);
    expect(evs).toHaveLength(2);
    expect(evs[1]).toMatchObject({
      fromStatus: "pendiente_aprobacion",
      toStatus: "en_preparacion",
      userId: fx.userId,
      note: null,
    });
  });

  it("paymentVerified is irrelevant for cash (still pending)", async () => {
    const o = await placeWebOrder(fx, { paymentMethod: "cash" });
    expect(await approve(o.id, { paymentVerified: true })).toMatchObject({ ok: true, data: { paymentStatus: "pending" } });
  });
});

describe("approveOrder: print jobs", () => {
  // fx.stationId = Mostrador station, fx.otherStationId = Delivery station.
  for (const [fulfillment, paymentMethod, station, expected] of [
    ["delivery", "cash", "otherStationId", ["delivery", "customer"]],
    ["delivery", "transfer", "otherStationId", ["delivery", "customer"]],
    ["takeaway", "cash", "stationId", ["customer"]],
    ["takeaway", "transfer", "stationId", ["customer"]],
    ["delivery", "cash", "stationId", ["customer"]], // admin approving a delivery order at a Mostrador station: station kind rules
    ["takeaway", "cash", "otherStationId", ["customer"]], // a takeaway order has no dispatch ticket even at a Delivery station
  ] as const) {
    it(`${fulfillment}/${paymentMethod} approved at a ${station === "stationId" ? "Mostrador" : "Delivery"} station: ${expected.join(" + ")}`, async () => {
      const o = await placeWebOrder(fx, { fulfillment, paymentMethod });
      const r = await approve(o.id, { paymentVerified: true, stationId: fx[station] });
      if (!r.ok) throw new Error(r.message);
      const js = await jobs(o.id);
      expect(js.map((j) => j.type)).toEqual(expected);
      expect(js.map((j) => j.id)).toEqual(r.data.printJobIds);
      for (const j of js) expect(j).toMatchObject({ stationId: fx[station], status: "pending", attempts: 0 });

      const row = await order(o.id);
      const items = await db().select().from(s.orderItems).where(eq(s.orderItems.orderId, o.id));
      const mods = await db().select().from(s.orderItemModifiers);
      const printable = orderToPrintable(row, items, mods);
      const byType = Object.fromEntries(js.map((j) => [j.type, j.payload]));
      if (expected.length === 2) expect(byType.delivery).toEqual(JSON.parse(JSON.stringify(renderDeliveryTicket(printable))));
      expect(byType.customer).toEqual(JSON.parse(JSON.stringify(renderCustomerTicket(printable))));

      // No kitchen comanda anywhere (its uppercase labels / NOTA lines never reach the paper).
      const all = JSON.stringify(js.map((j) => j.payload));
      expect(all).not.toContain("SIN CHEDDAR");
      expect(all).not.toContain("NOTA: BIEN COCIDA");
      expect(js.some((j) => j.type === "kitchen" || j.type === "ticket")).toBe(false);

      const ticket = JSON.stringify(byType.customer);
      expect(ticket).toContain('{"type":"logo"}');
      expect(ticket).toContain("GRACIAS POR TU COMPRA");
      expect(ticket).toContain(
        paymentMethod === "transfer" ? "Pago: Transferencia (pagado)" : "Pago: Efectivo (pendiente de cobro)",
      );
      if (expected.length === 2) {
        const d = JSON.stringify(byType.delivery);
        expect(d).toContain("Av. Siempreviva 742");
        expect(d).toContain(row.whatsapp!);
        expect(d).toContain(paymentMethod === "transfer" ? "Pago: Transferencia (pagado)" : "Efectivo: cobrar");
        expect(d).not.toContain('"logo"');
        expect(d).not.toContain("GRACIAS");
        expect(d).toContain("Sin cheddar"); // modifications of the unit, in customer-facing wording
        expect(d).toContain("Nota: bien cocida");
      }
    });
  }

  it("print payloads keep the ORIGINAL snapshot names and prices after the catalog changes", async () => {
    const o = await placeWebOrder(fx, { paymentMethod: "cash" });
    await db().update(s.products).set({ name: "Renombrada XYZ", price: 1 }).where(eq(s.products.id, fx.ranchita));
    await db().update(s.modifiers).set({ name: "Otro nombre", priceDelta: 999_99 }).where(eq(s.modifiers.id, fx.dips));
    const r = await approve(o.id);
    if (!r.ok) throw new Error(r.message);
    const js = await jobs(o.id);
    const all = JSON.stringify(js.map((j) => j.payload));
    expect(all).toContain("Ranchita simple");
    expect(all).not.toContain("Renombrada XYZ");
    expect(all).not.toContain("Otro nombre");
    const row = await order(o.id);
    expect(JSON.stringify(js[1].payload)).toContain(`TOTAL: ${formatARS(row.total)}`);
    expect(row.total).toBeGreaterThan(20000_00);
  });

  it("uses the station of the approver, not any other", async () => {
    const o = await placeWebOrder(fx);
    await approve(o.id, { stationId: fx.stationId });
    expect((await jobs(o.id)).every((j) => j.stationId === fx.stationId)).toBe(true);
    expect((await order(o.id)).stationId).toBe(fx.stationId);
  });
});

describe("approveOrder: refusals leave no trace", () => {
  it("no station / unknown station -> STATION_REQUIRED", async () => {
    const o = await placeWebOrder(fx);
    for (const stationId of [null, 987654]) {
      expect(await approve(o.id, { stationId })).toEqual({
        ok: false,
        code: "STATION_REQUIRED",
        message: "Elegí tu estación para imprimir",
      });
    }
    expect((await order(o.id)).status).toBe("pendiente_aprobacion");
    expect(await jobs()).toHaveLength(0);
  });

  it("unknown order -> NOT_FOUND; bad input -> VALIDATION", async () => {
    expect(await approve(424242)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await approve(-1)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await approve(1.5)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await approve(1, { userId: 0 })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await approve(1, { paymentVerified: "yes" as unknown as boolean })).toMatchObject({
      ok: false,
      code: "VALIDATION",
    });
    expect(await jobs()).toHaveLength(0);
  });

  it("already approved order: INVALID_TRANSITION and no extra jobs", async () => {
    const o = await placeWebOrder(fx);
    await approve(o.id);
    expect(await approve(o.id)).toEqual({
      ok: false,
      code: "INVALID_TRANSITION",
      message: "Este pedido ya está en preparación",
    });
    expect(await jobs(o.id)).toHaveLength(2);
  });

  it("cancelled order cannot be approved", async () => {
    const o = await placeWebOrder(fx);
    await db().update(s.orders).set({ status: "cancelado" }).where(eq(s.orders.id, o.id));
    expect(await approve(o.id)).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(await jobs()).toHaveLength(0);
  });
});

describe("approveOrder: Review Focus 2 (double click / race)", () => {
  it("5 parallel approvals: one ok, four INVALID_TRANSITION, exactly 2 jobs and 1 approval event", async () => {
    const o = await placeWebOrder(fx, { paymentMethod: "transfer" });
    const rs = await Promise.all(Array.from({ length: 5 }, () => approve(o.id, { paymentVerified: true })));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok && r.code === "INVALID_TRANSITION")).toHaveLength(4);
    expect(await jobs(o.id)).toHaveLength(2);
    expect((await events(o.id)).filter((e) => e.toStatus === "en_preparacion")).toHaveLength(1);
  });
});

describe("approveOrder: notifications", () => {
  async function listen() {
    const client = new Client({ connectionString: getEnv().DATABASE_URL });
    await client.connect();
    await client.query("LISTEN orders_changed");
    await client.query("LISTEN print_job_created");
    const received: { channel: string; payload: unknown }[] = [];
    client.on("notification", (n) => received.push({ channel: n.channel, payload: JSON.parse(n.payload ?? "null") }));
    return { client, received };
  }
  const waitFor = async (pred: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  };

  it("after commit: one ORDERS status event and two PRINT events", async () => {
    const o = await placeWebOrder(fx);
    const { client, received } = await listen();
    try {
      received.length = 0;
      const r = await approve(o.id);
      if (!r.ok) throw new Error(r.message);
      await waitFor(() => received.length >= 3);
      await waitFor(() => received.length > 3, 150); // short negative wait: nothing extra arrives
      expect(received.filter((x) => x.channel === "orders_changed")).toEqual([
        { channel: "orders_changed", payload: { orderId: o.id, status: "en_preparacion", event: "status" } },
      ]);
      const prints = received.filter((x) => x.channel === "print_job_created").map((x) => x.payload);
      expect(prints).toEqual(r.data.printJobIds.map((jobId) => ({ jobId, stationId: fx.otherStationId })));
    } finally {
      await client.end();
    }
  });

  it("refused approvals emit nothing", async () => {
    const o = await placeWebOrder(fx, { paymentMethod: "transfer" });
    const { client, received } = await listen();
    try {
      received.length = 0;
      await approve(o.id, { paymentVerified: false });
      await approve(o.id, { stationId: null });
      await waitFor(() => received.length > 0, 400);
      expect(received).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it("a commit that FAILS after the notifies rolls back everything and emits nothing", async () => {
    const o = await placeWebOrder(fx);
    const { client, received } = await listen();
    try {
      received.length = 0;
      await db().execute(
        sql.raw(`
          CREATE FUNCTION boom_commit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom at commit'; END $$ LANGUAGE plpgsql;
          CREATE CONSTRAINT TRIGGER boom_commit_trg AFTER INSERT ON print_jobs
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION boom_commit();`),
      );
      const r = await approve(o.id);
      expect(r).toMatchObject({ ok: false, code: "UNEXPECTED" });
      expect(JSON.stringify(r)).not.toContain("boom");
      await waitFor(() => received.length > 0, 600);
      expect(received).toEqual([]);
      expect((await order(o.id)).status).toBe("pendiente_aprobacion");
      expect(await jobs()).toHaveLength(0);
      expect((await events(o.id)).map((e) => e.toStatus)).toEqual(["pendiente_aprobacion"]);

      await dropFailureTriggers();
      expect(await approve(o.id)).toMatchObject({ ok: true });
      await waitFor(() => received.length >= 3);
      expect(received).toHaveLength(3);
    } finally {
      await client.end();
    }
  });
});
