import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { closeDb } from "@/db/client";
import { businessDateFor } from "@/db/order-number";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { renderCustomerTicket, renderKitchenTicket } from "@/domain/print-document";
import { orderTotals } from "@/domain/pricing";
import { getEnv } from "@/lib/env";
import { createCounterOrder, type CreateCounterOrderData, type CreateCounterOrderResult } from "./create-counter-order";
import { loadPrintableOrder } from "./print-jobs";

const db = () => testDb();
const KEY = "3f2b8c1e-5d4a-4b7c-9e1f-0a2b3c4d5e6f";
const NOW = new Date("2026-10-14T23:30:00Z");

type Fx = {
  ranchita: number;
  melt: number;
  hidden: number;
  sinCheddar: number;
  dips: number;
  swapA: number;
  swapB: number;
  foreignMod: number;
  inactiveMod: number;
  cora: number;
  station: number;
};

async function seed(): Promise<Fx> {
  const d = db();
  const [cat] = await d.insert(s.categories).values({ name: "Burgers", slug: "burgers" }).returning();
  const [dead] = await d.insert(s.categories).values({ name: "Muerta", slug: "muerta", active: false }).returning();
  const [ranchita, melt] = await d
    .insert(s.products)
    .values([
      { categoryId: cat.id, name: "Ranchita simple", price: 8500_00 },
      { categoryId: cat.id, name: "Melt simple", price: 8800_00 },
    ])
    .returning();
  const [hidden] = await d.insert(s.products).values({ categoryId: dead.id, name: "Oculto", price: 1 }).returning();
  const [gQuit, gAdd, gSwap, gForeign] = await d
    .insert(s.modifierGroups)
    .values([{ name: "Quitar" }, { name: "Agregados" }, { name: "Cambiar" }, { name: "Solo melt" }])
    .returning();
  const mods = await d
    .insert(s.modifiers)
    .values([
      { groupId: gQuit.id, name: "Sin cheddar", kind: "remove", priceDelta: 0, kitchenLabel: "SIN CHEDDAR" },
      { groupId: gAdd.id, name: "Dips", kind: "add", priceDelta: 1200_00, kitchenLabel: "+ DIPS" },
      { groupId: gSwap.id, name: "Pan negro", kind: "swap", priceDelta: 300_00, kitchenLabel: "PAN NEGRO" },
      { groupId: gSwap.id, name: "Pan sin gluten", kind: "swap", priceDelta: 500_00, kitchenLabel: "PAN SIN GLUTEN" },
      { groupId: gForeign.id, name: "Extra melt", kind: "add", priceDelta: 100_00, kitchenLabel: "+ MELT" },
      { groupId: gAdd.id, name: "Inactivo", kind: "add", priceDelta: 100_00, kitchenLabel: "+ INACT", active: false },
    ])
    .returning();
  await d.insert(s.productModifierGroups).values([
    { productId: ranchita.id, groupId: gQuit.id },
    { productId: ranchita.id, groupId: gAdd.id },
    { productId: ranchita.id, groupId: gSwap.id },
    { productId: melt.id, groupId: gForeign.id },
    { productId: melt.id, groupId: gQuit.id },
  ]);
  const [cora] = await d
    .insert(s.users)
    .values({ name: "Cora", username: "cora", passwordHash: "x", role: "cajera" })
    .returning();
  const [st] = await d
    .insert(s.stations)
    .values([
      { name: "Mostrador 1", kind: "mostrador" },
      { name: "Delivery", kind: "delivery" },
    ])
    .returning();
  return {
    ranchita: ranchita.id,
    melt: melt.id,
    hidden: hidden.id,
    sinCheddar: mods[0].id,
    dips: mods[1].id,
    swapA: mods[2].id,
    swapB: mods[3].id,
    foreignMod: mods[4].id,
    inactiveMod: mods[5].id,
    cora: cora.id,
    station: st.id,
  };
}

const input = (fx: Fx, over: Record<string, unknown> = {}) => ({
  idempotencyKey: KEY,
  units: [
    { productId: fx.ranchita, modifierIds: [fx.dips, fx.sinCheddar], note: "bien cocida" },
    { productId: fx.ranchita, modifierIds: [fx.swapA], note: "" },
  ],
  paymentMethod: "cash",
  pagerNumber: 7,
  customerName: "Ana",
  userId: fx.cora,
  stationId: fx.station,
  ...over,
});
const fresh = (fx: Fx, over: Record<string, unknown> = {}) => input(fx, { idempotencyKey: crypto.randomUUID(), ...over });

const counts = async () => ({
  orders: (await db().select().from(s.orders)).length,
  items: (await db().select().from(s.orderItems)).length,
  mods: (await db().select().from(s.orderItemModifiers)).length,
  events: (await db().select().from(s.orderEvents)).length,
  jobs: (await db().select().from(s.printJobs)).length,
  counters: await db().select().from(s.dailyCounters),
});
const EMPTY = { orders: 0, items: 0, mods: 0, events: 0, jobs: 0, counters: [] };

/** Test-only failure-injection function (its triggers go with it). */
async function dropFailureTriggers() {
  await db().execute(sql.raw("DROP FUNCTION IF EXISTS boom_commit() CASCADE;"));
}

const okData = (r: CreateCounterOrderResult): CreateCounterOrderData => {
  if (!r.ok) throw new Error(`unexpected failure: ${JSON.stringify(r)}`);
  return r.data;
};

let fx: Fx;
beforeEach(async () => {
  await dropFailureTriggers();
  await resetDb();
  fx = await seed();
});
afterEach(dropFailureTriggers);
afterAll(async () => {
  await dropFailureTriggers();
  await closeDb();
});

describe("createCounterOrder: happy path", () => {
  it.each(["cash", "transfer"] as const)("%s: born en_preparacion and paid, priced from the DB, no fee", async (pm) => {
    await db().insert(s.settings).values({ key: "delivery_fee", value: 1500_00 });
    const r = await createCounterOrder(db(), input(fx, { paymentMethod: pm }), { now: NOW, newToken: () => "a".repeat(32) });
    const expected = orderTotals(
      [
        { basePrice: 8500_00, modifiers: [{ priceDelta: 1200_00 }, { priceDelta: 0 }] },
        { basePrice: 8500_00, modifiers: [{ priceDelta: 300_00 }] },
      ],
      0,
    );
    const [o] = await db().select().from(s.orders);
    expect(r).toEqual({
      ok: true,
      data: {
        orderId: o.id,
        number: 1,
        pagerNumber: 7,
        total: expected.total,
        paymentMethod: pm,
        printJobIds: expect.any(Array),
        duplicate: false,
      },
    });
    expect(expected.total).toBe(8500_00 * 2 + 1200_00 + 300_00);
    expect(o).toMatchObject({
      businessDate: businessDateFor(NOW),
      number: 1,
      publicToken: "a".repeat(32),
      idempotencyKey: KEY,
      channel: "counter",
      fulfillment: "takeaway",
      status: "en_preparacion",
      paymentMethod: pm,
      paymentStatus: "paid",
      customerName: "Ana",
      whatsapp: null,
      address: null,
      crossStreets: null,
      addressNotes: null,
      pagerNumber: 7,
      subtotal: expected.subtotal,
      deliveryFee: 0,
      total: expected.total,
      approvedBy: fx.cora,
      stationId: fx.station,
      cadetId: null,
    });
    expect(o.approvedAt?.toISOString()).toBe(NOW.toISOString());
    expect(o.createdAt.toISOString()).toBe(NOW.toISOString());
    const [ev] = await db().select().from(s.orderEvents);
    expect(ev).toMatchObject({
      orderId: o.id,
      fromStatus: null,
      toStatus: "en_preparacion",
      userId: fx.cora,
      note: "Venta de mostrador",
    });
  });

  it("customerName is NULL when omitted or blank; random token is 32 hex", async () => {
    okData(await createCounterOrder(db(), input(fx, { customerName: undefined }), {}));
    const [o] = await db().select().from(s.orders);
    expect(o.customerName).toBeNull();
    expect(o.publicToken).toMatch(/^[0-9a-f]{32}$/);
    okData(await createCounterOrder(db(), fresh(fx, { pagerNumber: 8, customerName: "   " }), {}));
    expect((await db().select().from(s.orders).where(eq(s.orders.pagerNumber, 8)))[0].customerName).toBeNull();
  });

  it("ONE order_items row per unit with own modifier snapshots that survive catalog edits", async () => {
    await createCounterOrder(db(), input(fx), {});
    await db().update(s.products).set({ name: "Otra", price: 1 }).where(eq(s.products.id, fx.ranchita));
    await db().update(s.modifiers).set({ name: "Otro", priceDelta: 1, kitchenLabel: "X" }).where(eq(s.modifiers.id, fx.dips));
    const items = await db().select().from(s.orderItems).orderBy(asc(s.orderItems.id));
    expect(items.map((i) => [i.productId, i.nameSnapshot, i.unitPriceSnapshot, i.notes])).toEqual([
      [fx.ranchita, "Ranchita simple", 8500_00, "bien cocida"],
      [fx.ranchita, "Ranchita simple", 8500_00, null],
    ]);
    const mods = await db().select().from(s.orderItemModifiers);
    const of = (id: number) => mods.filter((m) => m.orderItemId === id).map((m) => m.modifierId).sort();
    expect(of(items[0].id)).toEqual([fx.sinCheddar, fx.dips].sort());
    expect(of(items[1].id)).toEqual([fx.swapA]);
    expect(mods.find((m) => m.modifierId === fx.dips)).toMatchObject({
      nameSnapshot: "Dips",
      kitchenLabel: "+ DIPS",
      priceDelta: 1200_00,
    });
  });

  it("exactly TWO print jobs (kitchen + ticket) for the session station, payloads = domain renderers over the DB rows", async () => {
    const r = okData(await createCounterOrder(db(), input(fx, { paymentMethod: "transfer" }), { now: NOW }));
    const jobs = await db().select().from(s.printJobs).orderBy(asc(s.printJobs.id));
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.id)).toEqual(r.printJobIds);
    expect(jobs.map((j) => [j.type, j.stationId, j.orderId, j.status, j.attempts])).toEqual([
      ["kitchen", fx.station, r.orderId, "pending", 0],
      ["ticket", fx.station, r.orderId, "pending", 0],
    ]);
    const printable = await db().transaction((tx) => loadPrintableOrder(tx, r.orderId));
    const json = (v: unknown) => JSON.parse(JSON.stringify(v));
    expect(jobs[0].payload).toEqual(json(renderKitchenTicket(printable!)));
    expect(jobs[1].payload).toEqual(json(renderCustomerTicket(printable!)));
    const ticket = JSON.stringify(jobs[1].payload);
    expect(ticket).toContain("LLAMADOR 7");
    expect(ticket).toContain("Pago: Transferencia (pagado)");
    const kitchen = JSON.stringify(jobs[0].payload);
    expect(kitchen).toContain("MOSTRADOR");
    expect(kitchen).toContain("SIN CHEDDAR");
    expect(kitchen).toContain("LLAMADOR 7");
  });

  it("cash ticket says 'Pago: Efectivo (pagado)'", async () => {
    await createCounterOrder(db(), input(fx), {});
    const [, ticket] = await db().select().from(s.printJobs).orderBy(asc(s.printJobs.id));
    expect(JSON.stringify(ticket.payload)).toContain("Pago: Efectivo (pagado)");
  });

  it("forged price/status fields are ignored", async () => {
    const forged = input(fx, {
      total: 1,
      subtotal: 1,
      status: "entregado",
      paymentStatus: "pending",
      channel: "web",
      units: [{ productId: fx.ranchita, modifierIds: [fx.dips], note: "", price: 1, unitPrice: 1, priceDelta: -5 }],
    });
    const r = okData(await createCounterOrder(db(), forged, {}));
    expect(r.total).toBe(8500_00 + 1200_00);
    const [o] = await db().select().from(s.orders);
    expect(o).toMatchObject({ status: "en_preparacion", paymentStatus: "paid", channel: "counter", total: 9700_00 });
    const [i] = await db().select().from(s.orderItems);
    expect(i.unitPriceSnapshot).toBe(8500_00);
  });

  it("works while accepting_orders = false (counter sales ignore the web switch)", async () => {
    await db().insert(s.settings).values({ key: "accepting_orders", value: false });
    expect(await createCounterOrder(db(), input(fx), {})).toMatchObject({ ok: true });
  });
});

describe("createCounterOrder: validation, station, units", () => {
  it("VALIDATION with fieldErrors, nothing written", async () => {
    const r = await createCounterOrder(db(), input(fx, { pagerNumber: 0, units: [] }), {});
    expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    if (!r.ok) expect(Object.keys(r.fieldErrors!).sort()).toEqual(["pagerNumber", "units"]);
    expect(await counts()).toEqual(EMPTY);
  });

  it("missing pagerNumber fails", async () => {
    expect(await createCounterOrder(db(), input(fx, { pagerNumber: undefined }), {})).toMatchObject({
      ok: false,
      code: "VALIDATION",
    });
    expect(await counts()).toEqual(EMPTY);
  });

  it.each([null, undefined, 5, "x", []])("garbage %j -> VALIDATION without throwing", async (g) => {
    expect(await createCounterOrder(db(), g, {})).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it.each([null, 999999])("stationId %j -> STATION_REQUIRED, nothing written", async (stationId) => {
    const r = await createCounterOrder(db(), input(fx, { stationId }), {});
    expect(r).toEqual({ ok: false, code: "STATION_REQUIRED", message: "Elegí tu estación para imprimir" });
    expect(await counts()).toEqual(EMPTY);
  });

  it("an idempotent retry is answered even if the station is missing (lookup comes first)", async () => {
    const a = okData(await createCounterOrder(db(), input(fx), {}));
    const b = await createCounterOrder(db(), input(fx, { stationId: null }), {});
    expect(b).toEqual({ ok: true, data: { ...a, duplicate: true } });
  });

  const rolledBack = async () => expect(await counts()).toEqual(EMPTY);

  it("inactive product / inactive category -> UNITS_INVALID with unitIssues, zero rows (counter rolled back)", async () => {
    await db().update(s.products).set({ active: false }).where(eq(s.products.id, fx.melt));
    const r = await createCounterOrder(
      db(),
      input(fx, {
        units: [
          { productId: fx.ranchita, modifierIds: [], note: "" },
          { productId: fx.melt, modifierIds: [], note: "" },
          { productId: fx.hidden, modifierIds: [], note: "" },
        ],
      }),
      {},
    );
    expect(r).toMatchObject({
      ok: false,
      code: "UNITS_INVALID",
      unitIssues: [
        { unitIndex: 1, code: "PRODUCT_UNAVAILABLE" },
        { unitIndex: 2, code: "PRODUCT_UNAVAILABLE" },
      ],
    });
    await rolledBack();
  });

  it("two swaps -> INVALID_SELECTION; foreign-group / inactive modifier -> MODIFIER_UNAVAILABLE", async () => {
    expect(
      await createCounterOrder(
        db(),
        input(fx, { units: [{ productId: fx.ranchita, modifierIds: [fx.swapA, fx.swapB], note: "" }] }),
        {},
      ),
    ).toMatchObject({ ok: false, unitIssues: [{ unitIndex: 0, code: "INVALID_SELECTION" }] });
    for (const id of [fx.foreignMod, fx.inactiveMod]) {
      expect(
        await createCounterOrder(db(), input(fx, { units: [{ productId: fx.ranchita, modifierIds: [id], note: "" }] }), {}),
      ).toMatchObject({ ok: false, code: "UNITS_INVALID", unitIssues: [{ unitIndex: 0, code: "MODIFIER_UNAVAILABLE" }] });
    }
    await rolledBack();
  });
});

describe("createCounterOrder: pager uniqueness", () => {
  it("PAGER_IN_USE names the holder order; the second sale writes nothing and burns no number", async () => {
    const first = okData(await createCounterOrder(db(), input(fx), {}));
    const r = await createCounterOrder(db(), fresh(fx), {});
    expect(r).toEqual({
      ok: false,
      code: "PAGER_IN_USE",
      message: `El llamador 7 ya está en uso por el pedido #${first.number}`,
    });
    const c = await counts();
    expect([c.orders, c.items, c.events, c.jobs]).toEqual([1, 2, 1, 2]);
    expect(c.counters).toEqual([{ businessDate: expect.any(String), lastNumber: 1 }]);
  });

  it("a different pager is fine", async () => {
    okData(await createCounterOrder(db(), input(fx), {}));
    okData(await createCounterOrder(db(), fresh(fx, { pagerNumber: 8 }), {}));
  });

  it.each(["entregado", "cancelado"] as const)("the pager is reusable once the holder is %s", async (status) => {
    const first = okData(await createCounterOrder(db(), input(fx), {}));
    await db().update(s.orders).set({ status }).where(eq(s.orders.id, first.orderId));
    expect(await createCounterOrder(db(), fresh(fx), {})).toMatchObject({ ok: true });
  });

  it.each(["listo_despacho", "para_retirar"] as const)("still in use while the holder is %s", async (status) => {
    const first = okData(await createCounterOrder(db(), input(fx), {}));
    await db().update(s.orders).set({ status }).where(eq(s.orders.id, first.orderId));
    expect(await createCounterOrder(db(), fresh(fx), {})).toMatchObject({ ok: false, code: "PAGER_IN_USE" });
  });

  it("a WEB order never blocks a pager", async () => {
    await db().insert(s.orders).values({
      businessDate: "2026-10-14",
      number: 50,
      publicToken: "w".repeat(32),
      channel: "web",
      fulfillment: "takeaway",
      status: "en_preparacion",
      paymentMethod: "cash",
      customerName: "Web",
      pagerNumber: null,
      subtotal: 1,
      total: 1,
    });
    expect(await createCounterOrder(db(), input(fx), {})).toMatchObject({ ok: true });
  });

  it("the unique index backstop maps 23505 to PAGER_IN_USE (holder invisible to the in-tx check)", async () => {
    // Another transaction holds pager 7 UNCOMMITTED: the sale's pre-check cannot see it, its
    // insert waits on the index and fails with 23505 once the other transaction commits.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let inserted!: () => void;
    const insertedP = new Promise<void>((r) => (inserted = r));
    const holder = db().transaction(async (tx) => {
      await tx.insert(s.orders).values({
        businessDate: "2000-01-01",
        number: 999,
        publicToken: "racer",
        channel: "counter",
        fulfillment: "takeaway",
        status: "en_preparacion",
        paymentMethod: "cash",
        paymentStatus: "paid",
        customerName: null,
        pagerNumber: 7,
        subtotal: 1,
        total: 1,
      });
      inserted();
      await gate;
    });
    await insertedP;
    let settled = false;
    const sale = createCounterOrder(db(), input(fx), {}).finally(() => (settled = true));
    await new Promise((r) => setTimeout(r, 300)); // short negative wait: the sale is blocked on the index
    expect(settled).toBe(false);
    release();
    await holder;
    const r = await sale;
    expect(r).toEqual({ ok: false, code: "PAGER_IN_USE", message: "El llamador 7 ya está en uso por el pedido #999" });
    expect((await db().select().from(s.orders)).map((o) => o.publicToken)).toEqual(["racer"]);
    expect((await counts()).jobs).toBe(0);
  });
});

describe("createCounterOrder: concurrency", () => {
  // The per-pager advisory lock serializes these: the losers are rejected by the in-transaction
  // check. The unique-index mapping (23505) is covered deterministically by the backstop test above.
  it("5 PARALLEL sales with the SAME pager -> exactly ONE ok, four PAGER_IN_USE, one order, 2 print jobs", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => createCounterOrder(db(), fresh(fx), {})));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const losers = results.filter((r) => !r.ok);
    expect(losers).toHaveLength(4);
    for (const l of losers) expect(l).toMatchObject({ ok: false, code: "PAGER_IN_USE" });
    const c = await counts();
    expect([c.orders, c.items, c.events, c.jobs]).toEqual([1, 2, 1, 2]);
  });

  it("5 PARALLEL sales with the same idempotency key -> one order, duplicate true for the rest", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => createCounterOrder(db(), input(fx), {})));
    const datas = results.map(okData);
    expect(datas.filter((d) => !d.duplicate)).toHaveLength(1);
    expect(new Set(datas.map((d) => d.orderId)).size).toBe(1);
    const c = await counts();
    expect([c.orders, c.events, c.jobs]).toEqual([1, 1, 2]);
    expect(c.counters).toEqual([{ businessDate: expect.any(String), lastNumber: 1 }]);
  });

  it("10 parallel sales with different pagers -> unique order numbers 1..10", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => createCounterOrder(db(), fresh(fx, { pagerNumber: i + 1 }), { now: NOW })),
    );
    const numbers = results.map(okData).map((d) => d.number).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await counts()).jobs).toBe(20);
  });
});

describe("createCounterOrder: idempotency", () => {
  it("same key sequentially -> same order, duplicate: true, no extra rows", async () => {
    const a = okData(await createCounterOrder(db(), input(fx), {}));
    const b = okData(await createCounterOrder(db(), input(fx, { pagerNumber: 9 }), {}));
    expect(a.duplicate).toBe(false);
    expect(b).toEqual({ ...a, duplicate: true });
    const c = await counts();
    expect([c.orders, c.items, c.events, c.jobs]).toEqual([1, 2, 1, 2]);
  });
});

describe("createCounterOrder: key scoping", () => {
  it("a WEB order holding the same idempotency key is never returned by a counter sale", async () => {
    const [web] = await db()
      .insert(s.orders)
      .values({
        businessDate: "2026-10-14",
        number: 1,
        publicToken: "web-tok",
        idempotencyKey: KEY,
        channel: "web",
        fulfillment: "takeaway",
        status: "pendiente_aprobacion",
        paymentMethod: "cash",
        customerName: "Web",
        subtotal: 1,
        total: 1,
      })
      .returning();
    const out = await createCounterOrder(db(), input(fx), {}).then(
      (r) => r,
      (e: unknown) => e,
    );
    // The unique index still forbids a second row with that key, so the sale errors out; what
    // matters is that it is never a "duplicate" success pointing at the web order.
    expect(out).not.toMatchObject({ ok: true });
    expect(web.id).toBeGreaterThan(0);
    expect((await counts()).jobs).toBe(0);
  });
});

describe("createCounterOrder: notifications", () => {
  async function listener() {
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

  it("after COMMIT: one ORDERS created event + two PRINT events for the station", async () => {
    const { client, received } = await listener();
    try {
      const r = okData(await createCounterOrder(db(), input(fx), {}));
      await waitFor(() => received.length >= 3);
      await new Promise((res) => setTimeout(res, 150)); // short negative wait: nothing extra
      expect(received.filter((n) => n.channel === "orders_changed").map((n) => n.payload)).toEqual([
        { orderId: r.orderId, status: "en_preparacion", event: "created" },
      ]);
      expect(received.filter((n) => n.channel === "print_job_created").map((n) => n.payload)).toEqual(
        r.printJobIds.map((jobId) => ({ jobId, stationId: fx.station })),
      );
    } finally {
      await client.end();
    }
  });

  it("rejections and duplicates emit nothing", async () => {
    okData(await createCounterOrder(db(), input(fx), {}));
    const { client, received } = await listener();
    try {
      await createCounterOrder(db(), input(fx), {}); // duplicate
      await createCounterOrder(db(), fresh(fx), {}); // PAGER_IN_USE
      await createCounterOrder(db(), fresh(fx, { pagerNumber: 9, stationId: null }), {}); // STATION_REQUIRED
      await waitFor(() => received.length > 0, 500);
      expect(received).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it("a commit that FAILS after the notifies ran emits nothing and leaves no rows", async () => {
    const { client, received } = await listener();
    try {
      await db().execute(
        sql.raw(`
          CREATE FUNCTION boom_commit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom at commit'; END $$ LANGUAGE plpgsql;
          CREATE CONSTRAINT TRIGGER boom_commit_trg AFTER INSERT ON orders
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION boom_commit();`),
      );
      await expect(createCounterOrder(db(), input(fx), {})).rejects.toThrow();
      await waitFor(() => received.length > 0, 600);
      expect(received).toEqual([]);
      expect(await counts()).toEqual(EMPTY);

      // control: without the trigger the very same call notifies (1 order + 2 print events)
      await dropFailureTriggers();
      okData(await createCounterOrder(db(), input(fx), {}));
      await waitFor(() => received.length >= 3);
      expect(received).toHaveLength(3);
    } finally {
      await client.end();
    }
  });
});

describe("createCounterOrder: atomicity", () => {
  it("a failing print_jobs insert leaves no partial order and burns no number", async () => {
    await db().execute(
      sql.raw(`
        CREATE FUNCTION boom_commit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$ LANGUAGE plpgsql;
        CREATE TRIGGER boom_commit_trg BEFORE INSERT ON print_jobs FOR EACH ROW EXECUTE FUNCTION boom_commit();`),
    );
    await expect(createCounterOrder(db(), input(fx), {})).rejects.toThrow();
    expect(await counts()).toEqual(EMPTY);
  });
});
