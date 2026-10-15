import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { closeDb } from "@/db/client";
import { businessDateFor } from "@/db/order-number";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { orderTotals } from "@/domain/pricing";
import { getEnv } from "@/lib/env";
import { createOrder } from "./create-order";

const db = () => testDb();
const KEY = "3f2b8c1e-5d4a-4b7c-9e1f-0a2b3c4d5e6f";
const NOW = new Date("2026-10-14T23:30:00Z");

type Fx = {
  ranchita: number;
  melt: number;
  hidden: number;
  noGroup: number;
  sinCheddar: number;
  dips: number;
  swapA: number;
  swapB: number;
  foreignMod: number;
  inactiveMod: number;
};

/** Categories, products, groups and modifiers. Prices in centavos. */
async function seedMenu(): Promise<Fx> {
  const d = db();
  const [cat] = await d.insert(s.categories).values({ name: "Burgers", slug: "burgers" }).returning();
  const [dead] = await d.insert(s.categories).values({ name: "Muerta", slug: "muerta", active: false }).returning();
  const [ranchita, melt, noGroup] = await d
    .insert(s.products)
    .values([
      { categoryId: cat.id, name: "Ranchita simple", price: 8500_00 },
      { categoryId: cat.id, name: "Melt simple", price: 8800_00 },
      { categoryId: cat.id, name: "Sin grupos", price: 1000_00 },
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
  return {
    ranchita: ranchita.id,
    melt: melt.id,
    hidden: hidden.id,
    noGroup: noGroup.id,
    sinCheddar: mods[0].id,
    dips: mods[1].id,
    swapA: mods[2].id,
    swapB: mods[3].id,
    foreignMod: mods[4].id,
    inactiveMod: mods[5].id,
  };
}

const setSetting = (key: string, value: unknown) =>
  db()
    .insert(s.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: s.settings.key, set: { value } });

const input = (fx: Fx, over: Record<string, unknown> = {}) => ({
  idempotencyKey: KEY,
  units: [
    { productId: fx.ranchita, modifierIds: [fx.dips, fx.sinCheddar], note: "bien cocida" },
    { productId: fx.ranchita, modifierIds: [fx.swapA], note: "" },
  ],
  customer: { name: "Juana Pérez", whatsapp: "+54 9 11 5555-1234" },
  fulfillment: "delivery",
  delivery: { address: "Av. Siempreviva 742", crossStreets: "Mitre y Sarmiento", notes: "timbre roto" },
  paymentMethod: "transfer",
  bh_ref: "",
  ...over,
});

const counts = async () => ({
  orders: (await db().select().from(s.orders)).length,
  items: (await db().select().from(s.orderItems)).length,
  mods: (await db().select().from(s.orderItemModifiers)).length,
  events: (await db().select().from(s.orderEvents)).length,
  counters: await db().select().from(s.dailyCounters),
});
const EMPTY = { orders: 0, items: 0, mods: 0, events: 0, counters: [] };

/** Test-only failure-injection functions (their triggers go with them). */
async function dropFailureTriggers() {
  await db().execute(sql.raw("DROP FUNCTION IF EXISTS boom() CASCADE; DROP FUNCTION IF EXISTS boom_commit() CASCADE;"));
}

let fx: Fx;
beforeEach(async () => {
  await dropFailureTriggers();
  await resetDb();
  fx = await seedMenu();
});
afterEach(dropFailureTriggers); // a dying test can never leak a trigger into other files
afterAll(async () => {
  await dropFailureTriggers();
  await closeDb();
});

describe("createOrder: happy path", () => {
  it("creates a delivery order priced from the DB with the delivery fee", async () => {
    await setSetting("delivery_fee", 1500_00);
    const r = await createOrder(db(), input(fx), { now: NOW, newToken: () => "a".repeat(32) });
    const expected = orderTotals(
      [
        { basePrice: 8500_00, modifiers: [{ priceDelta: 1200_00 }, { priceDelta: 0 }] },
        { basePrice: 8500_00, modifiers: [{ priceDelta: 300_00 }] },
      ],
      1500_00,
    );
    expect(r).toEqual({ ok: true, data: { publicToken: "a".repeat(32), number: 1, total: expected.total, duplicate: false } });
    expect(expected.total).toBe(8500_00 * 2 + 1200_00 + 300_00 + 1500_00);

    const [o] = await db().select().from(s.orders);
    expect(o).toMatchObject({
      businessDate: businessDateFor(NOW),
      number: 1,
      publicToken: "a".repeat(32),
      idempotencyKey: KEY,
      channel: "web",
      fulfillment: "delivery",
      status: "pendiente_aprobacion",
      paymentMethod: "transfer",
      paymentStatus: "pending",
      customerName: "Juana Pérez",
      whatsapp: "5491155551234",
      address: "Av. Siempreviva 742",
      crossStreets: "Mitre y Sarmiento",
      addressNotes: "timbre roto",
      pagerNumber: null,
      subtotal: expected.subtotal,
      deliveryFee: 1500_00,
      total: expected.total,
    });
    expect(o.createdAt.toISOString()).toBe(NOW.toISOString());
    expect(businessDateFor(NOW)).toBe("2026-10-14"); // 20:30 in Buenos Aires

    const [ev] = await db().select().from(s.orderEvents);
    expect(ev).toMatchObject({ orderId: o.id, fromStatus: null, toStatus: "pendiente_aprobacion", userId: null, note: "Pedido web" });
  });

  it("random token is 32 hex chars (16 bytes) by default and differs per order", async () => {
    const a = await createOrder(db(), input(fx), {});
    const b = await createOrder(db(), input(fx, { idempotencyKey: crypto.randomUUID() }), {});
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.data.publicToken).toMatch(/^[0-9a-f]{32}$/);
    expect(b.data.publicToken).toMatch(/^[0-9a-f]{32}$/);
    expect(a.data.publicToken).not.toBe(b.data.publicToken);
  });

  it("one order_items row PER UNIT, each with its own modifier snapshots", async () => {
    await createOrder(db(), input(fx), {});
    const items = await db().select().from(s.orderItems).orderBy(asc(s.orderItems.id));
    expect(items).toHaveLength(2);
    expect(items.map((i) => [i.productId, i.nameSnapshot, i.unitPriceSnapshot, i.notes])).toEqual([
      [fx.ranchita, "Ranchita simple", 8500_00, "bien cocida"],
      [fx.ranchita, "Ranchita simple", 8500_00, null],
    ]);
    const mods = await db().select().from(s.orderItemModifiers).orderBy(asc(s.orderItemModifiers.id));
    const of = (id: number) => mods.filter((m) => m.orderItemId === id).map((m) => m.modifierId).sort();
    expect(of(items[0].id)).toEqual([fx.sinCheddar, fx.dips].sort());
    expect(of(items[1].id)).toEqual([fx.swapA]);
    const dips = mods.find((m) => m.modifierId === fx.dips)!;
    expect(dips).toMatchObject({ nameSnapshot: "Dips", kitchenLabel: "+ DIPS", kind: "add", priceDelta: 1200_00 });
  });

  it("snapshots survive later menu edits", async () => {
    await createOrder(db(), input(fx), {});
    await db().update(s.products).set({ name: "Otra", price: 1 }).where(eq(s.products.id, fx.ranchita));
    await db().update(s.modifiers).set({ name: "Otro", priceDelta: 1, kitchenLabel: "X" }).where(eq(s.modifiers.id, fx.dips));
    const [item] = await db().select().from(s.orderItems).orderBy(asc(s.orderItems.id)).limit(1);
    expect(item).toMatchObject({ nameSnapshot: "Ranchita simple", unitPriceSnapshot: 8500_00 });
    const [dips] = await db().select().from(s.orderItemModifiers).where(eq(s.orderItemModifiers.modifierId, fx.dips));
    expect(dips).toMatchObject({ nameSnapshot: "Dips", priceDelta: 1200_00, kitchenLabel: "+ DIPS" });
  });

  it("takeaway: no fee, address fields NULL even if sent", async () => {
    await setSetting("delivery_fee", 1500_00);
    const r = await createOrder(db(), input(fx, { fulfillment: "takeaway", paymentMethod: "cash" }), {});
    if (!r.ok) throw new Error("expected ok");
    const [o] = await db().select().from(s.orders);
    expect(o).toMatchObject({
      fulfillment: "takeaway",
      paymentMethod: "cash",
      deliveryFee: 0,
      address: null,
      crossStreets: null,
      addressNotes: null,
      total: o.subtotal,
    });
    expect(r.data.total).toBe(o.subtotal);
  });

  it("delivery with the fee left unset charges nothing extra", async () => {
    const r = await createOrder(db(), input(fx), {});
    const [o] = await db().select().from(s.orders);
    expect(r.ok && r.data.total).toBe(o.subtotal);
    expect(o.deliveryFee).toBe(0);
  });

  it("collapses duplicate modifier ids and stores empty notes as NULL", async () => {
    await createOrder(db(), input(fx, { units: [{ productId: fx.ranchita, modifierIds: [fx.dips, fx.dips], note: "" }] }), {});
    expect(await db().select().from(s.orderItemModifiers)).toHaveLength(1);
    const [i] = await db().select().from(s.orderItems);
    expect(i.notes).toBeNull();
  });

  it("does not leak internal ids in the result", async () => {
    const r = await createOrder(db(), input(fx), {});
    if (!r.ok) throw new Error("expected ok");
    expect(Object.keys(r.data).sort()).toEqual(["duplicate", "number", "publicToken", "total"]);
  });
});

describe("createOrder: forged price fields (Review Focus 1)", () => {
  it("ignores client total/price/subtotal/fee/status and recomputes from the DB", async () => {
    await setSetting("delivery_fee", 1000_00);
    const forged = input(fx, {
      total: 1,
      subtotal: 1,
      deliveryFee: 0,
      status: "entregado",
      paymentStatus: "paid",
      payment_status: "paid",
      units: [{ productId: fx.ranchita, modifierIds: [fx.dips], note: "", price: 1, unitPrice: 1, total: 1, priceDelta: -5 }],
    });
    const r = await createOrder(db(), forged, {});
    const expected = orderTotals([{ basePrice: 8500_00, modifiers: [{ priceDelta: 1200_00 }] }], 1000_00);
    expect(r).toMatchObject({ ok: true, data: { total: expected.total } });
    const [o] = await db().select().from(s.orders);
    expect(o).toMatchObject({
      subtotal: expected.subtotal,
      deliveryFee: 1000_00,
      total: expected.total,
      status: "pendiente_aprobacion",
      paymentStatus: "pending",
    });
    const [i] = await db().select().from(s.orderItems);
    expect(i.unitPriceSnapshot).toBe(8500_00);
  });
});

describe("createOrder: validation", () => {
  it("returns VALIDATION with fieldErrors keyed by path and writes nothing", async () => {
    const r = await createOrder(
      db(),
      input(fx, { customer: { name: "x", whatsapp: "abc" }, delivery: { address: "ab", crossStreets: "", notes: "" } }),
      {},
    );
    expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    if (r.ok || r.code !== "VALIDATION") return;
    expect(Object.keys(r.fieldErrors!).sort()).toEqual([
      "customer.name",
      "customer.whatsapp",
      "delivery.address",
      "delivery.crossStreets",
    ]);
    expect(await counts()).toEqual(EMPTY);
  });

  it.each([null, undefined, 5, "str", []])("garbage input %j -> VALIDATION, no throw", async (garbage) => {
    expect(await createOrder(db(), garbage, {})).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("honeypot filled -> HONEYPOT, no rows, no hint of why", async () => {
    const r = await createOrder(db(), input(fx, { bh_ref: "http://spam" }), {});
    expect(r).toMatchObject({ ok: false, code: "HONEYPOT" });
    if (!r.ok) expect(r.message).not.toMatch(/honeypot|bh_ref|bot|spam/i);
    expect(await counts()).toEqual(EMPTY);
  });

  it("honeypot wins even when the rest is invalid", async () => {
    expect(await createOrder(db(), { bh_ref: "x" }, {})).toMatchObject({ ok: false, code: "HONEYPOT" });
  });
});

describe("createOrder: closed store", () => {
  it("STORE_CLOSED when accepting_orders is false, no rows", async () => {
    await setSetting("accepting_orders", false);
    const r = await createOrder(db(), input(fx), {});
    expect(r).toEqual({ ok: false, code: "STORE_CLOSED", message: "Por el momento no estamos tomando pedidos" });
    expect(await counts()).toEqual(EMPTY);
  });
  it("a retry of an ALREADY CREATED order still answers with it after the store closes", async () => {
    const first = await createOrder(db(), input(fx), {});
    if (!first.ok) throw new Error("expected ok");
    await setSetting("accepting_orders", false);
    const again = await createOrder(db(), input(fx), {});
    expect(again).toEqual({ ok: true, data: { ...first.data, duplicate: true } });
    expect((await counts()).orders).toBe(1);
    // a NEW order (different key) is still refused
    expect(await createOrder(db(), input(fx, { idempotencyKey: crypto.randomUUID() }), {})).toMatchObject({
      ok: false,
      code: "STORE_CLOSED",
    });
    expect((await counts()).orders).toBe(1);
  });
  it("reads the switch fresh on every call", async () => {
    await setSetting("accepting_orders", false);
    expect(await createOrder(db(), input(fx), {})).toMatchObject({ ok: false, code: "STORE_CLOSED" });
    await setSetting("accepting_orders", true);
    expect(await createOrder(db(), input(fx), {})).toMatchObject({ ok: true });
  });
});

describe("createOrder: stale / invalid units (Review Focus 4)", () => {
  const rolledBack = async () => expect(await counts()).toEqual(EMPTY);

  it("deactivated product -> UNITS_INVALID, nothing written", async () => {
    await db().update(s.products).set({ active: false }).where(eq(s.products.id, fx.melt));
    const r = await createOrder(
      db(),
      input(fx, { units: [{ productId: fx.ranchita, modifierIds: [], note: "" }, { productId: fx.melt, modifierIds: [], note: "" }] }),
      {},
    );
    expect(r).toMatchObject({ ok: false, code: "UNITS_INVALID", unitIssues: [{ unitIndex: 1, code: "PRODUCT_UNAVAILABLE" }] });
    await rolledBack();
  });

  it("product in an inactive category -> PRODUCT_UNAVAILABLE", async () => {
    const r = await createOrder(db(), input(fx, { units: [{ productId: fx.hidden, modifierIds: [], note: "" }] }), {});
    expect(r).toMatchObject({ ok: false, unitIssues: [{ unitIndex: 0, code: "PRODUCT_UNAVAILABLE" }] });
    await rolledBack();
  });

  it("deactivated modifier -> MODIFIER_UNAVAILABLE", async () => {
    await db().update(s.modifiers).set({ active: false }).where(eq(s.modifiers.id, fx.dips));
    const r = await createOrder(db(), input(fx), {});
    expect(r).toMatchObject({ ok: false, code: "UNITS_INVALID", unitIssues: [{ unitIndex: 0, code: "MODIFIER_UNAVAILABLE" }] });
    await rolledBack();
  });

  it("modifier from another product's group / inactive / nonexistent -> MODIFIER_UNAVAILABLE", async () => {
    for (const id of [fx.foreignMod, fx.inactiveMod, 999999]) {
      const r = await createOrder(db(), input(fx, { units: [{ productId: fx.ranchita, modifierIds: [id], note: "" }] }), {});
      expect(r).toMatchObject({ ok: false, unitIssues: [{ unitIndex: 0, code: "MODIFIER_UNAVAILABLE" }] });
    }
    await rolledBack();
  });

  it("product without linked groups cannot take any modifier", async () => {
    const r = await createOrder(db(), input(fx, { units: [{ productId: fx.noGroup, modifierIds: [fx.dips], note: "" }] }), {});
    expect(r).toMatchObject({ ok: false, unitIssues: [{ code: "MODIFIER_UNAVAILABLE" }] });
    await rolledBack();
  });

  it("two swaps of one group -> INVALID_SELECTION", async () => {
    const r = await createOrder(db(), input(fx, { units: [{ productId: fx.ranchita, modifierIds: [fx.swapA, fx.swapB], note: "" }] }), {});
    expect(r).toMatchObject({ ok: false, code: "UNITS_INVALID", unitIssues: [{ unitIndex: 0, code: "INVALID_SELECTION" }] });
    await rolledBack();
  });

  it("third unit invalid -> the two valid ones are NOT persisted", async () => {
    const ok = { productId: fx.ranchita, modifierIds: [fx.dips], note: "" };
    const r = await createOrder(db(), input(fx, { units: [ok, ok, { productId: 424242, modifierIds: [], note: "" }] }), {});
    expect(r).toMatchObject({ ok: false, code: "UNITS_INVALID", unitIssues: [{ unitIndex: 2, code: "PRODUCT_UNAVAILABLE" }] });
    await rolledBack();
  });
});

describe("createOrder: atomicity", () => {
  async function failOn(table: string, column: string, value: string) {
    await db().execute(
      sql.raw(`
        CREATE FUNCTION boom() RETURNS trigger AS $$
        BEGIN
          IF NEW.${column} = '${value}' THEN RAISE EXCEPTION 'boom'; END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql;
        CREATE TRIGGER boom_trg BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION boom();`),
    );
  }

  it("a failing insert on a late row leaves NO partial rows (and the counter rolls back)", async () => {
    await db().update(s.modifiers).set({ kitchenLabel: "BOOM" }).where(eq(s.modifiers.id, fx.swapA)); // 2nd unit's modifier
    await failOn("order_item_modifiers", "kitchen_label", "BOOM");
    await expect(createOrder(db(), input(fx), {})).rejects.toThrow();
    expect(await counts()).toEqual(EMPTY);
  });

  it("a failing order_events insert leaves nothing behind", async () => {
    await failOn("order_events", "note", "Pedido web");
    await expect(createOrder(db(), input(fx), {})).rejects.toThrow();
    expect(await counts()).toEqual(EMPTY);
  });
});

describe("createOrder: idempotency (Review Focus 2)", () => {
  it("same key twice sequentially -> same token/number, duplicate: true, ONE order", async () => {
    await setSetting("delivery_fee", 1500_00);
    const a = await createOrder(db(), input(fx), {});
    const b = await createOrder(db(), input(fx), {});
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.data.duplicate).toBe(false);
    expect(b.data).toEqual({ ...a.data, duplicate: true });
    expect((await counts()).orders).toBe(1);
    expect((await counts()).items).toBe(2);
    expect((await counts()).events).toBe(1);
  });

  it("returns the ORIGINAL order even if the retry payload differs", async () => {
    const a = await createOrder(db(), input(fx), {});
    const b = await createOrder(db(), input(fx, { units: [{ productId: fx.melt, modifierIds: [], note: "" }] }), {});
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(b.data).toEqual({ ...a.data, duplicate: true });
  });

  it("5 PARALLEL calls with the same key -> exactly ONE order, same token everywhere, no burned numbers", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => createOrder(db(), input(fx), {})));
    const oks = results.map((r) => {
      if (!r.ok) throw new Error(`unexpected failure: ${r.code}`);
      return r.data;
    });
    expect(new Set(oks.map((d) => d.publicToken)).size).toBe(1);
    expect(new Set(oks.map((d) => d.number))).toEqual(new Set([1]));
    expect(oks.filter((d) => !d.duplicate)).toHaveLength(1);
    const c = await counts();
    expect([c.orders, c.items, c.events]).toEqual([1, 2, 1]);
    expect(c.counters).toEqual([{ businessDate: expect.any(String), lastNumber: 1 }]);
  });

  it("different keys are different orders", async () => {
    await createOrder(db(), input(fx), {});
    await createOrder(db(), input(fx, { idempotencyKey: crypto.randomUUID() }), {});
    expect((await counts()).orders).toBe(2);
  });
});

describe("createOrder: concurrency", () => {
  it("10 parallel orders with different keys get unique numbers 1..10", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => createOrder(db(), input(fx, { idempotencyKey: crypto.randomUUID() }), { now: NOW })),
    );
    const numbers = results.map((r) => {
      if (!r.ok) throw new Error(`unexpected failure: ${r.code}`);
      return r.data.number;
    });
    expect([...numbers].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await counts()).orders).toBe(10);
  });
});

describe("createOrder: orders_changed notification", () => {
  async function listener() {
    const client = new Client({ connectionString: getEnv().DATABASE_URL });
    await client.connect();
    await client.query("LISTEN orders_changed");
    const received: string[] = [];
    client.on("notification", (n) => received.push(n.payload ?? ""));
    return { client, received };
  }
  const waitFor = async (pred: () => boolean, ms = 3000) => {
    const end = Date.now() + ms;
    while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
  };

  it("emits { orderId, status, event } on commit", async () => {
    const { client, received } = await listener();
    try {
      const r = await createOrder(db(), input(fx), {});
      if (!r.ok) throw new Error("expected ok");
      await waitFor(() => received.length > 0);
      const [o] = await db().select().from(s.orders);
      expect(received.map((p) => JSON.parse(p))).toEqual([{ orderId: o.id, status: "pendiente_aprobacion", event: "created" }]);
    } finally {
      await client.end();
    }
  });

  it("a duplicate submit does not emit again", async () => {
    const { client, received } = await listener();
    try {
      await createOrder(db(), input(fx), {});
      await createOrder(db(), input(fx), {});
      await waitFor(() => received.length > 1, 500);
      expect(received).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it("rejected creations emit nothing (units invalid, closed store)", async () => {
    const { client, received } = await listener();
    try {
      await createOrder(db(), input(fx, { units: [{ productId: 424242, modifierIds: [], note: "" }] }), {});
      await setSetting("accepting_orders", false);
      await createOrder(db(), input(fx), {});
      await waitFor(() => received.length > 0, 600);
      expect(received).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it("a commit that FAILS after pg_notify ran emits nothing and leaves no rows", async () => {
    const { client, received } = await listener();
    try {
      // Deferred constraint trigger: raises at COMMIT, i.e. after the pg_notify statement executed.
      await db().execute(
        sql.raw(`
          CREATE FUNCTION boom_commit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom at commit'; END $$ LANGUAGE plpgsql;
          CREATE CONSTRAINT TRIGGER boom_commit_trg AFTER INSERT ON orders
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION boom_commit();`),
      );
      await expect(createOrder(db(), input(fx), {})).rejects.toThrow();
      await waitFor(() => received.length > 0, 600);
      expect(received).toEqual([]);
      expect(await counts()).toEqual(EMPTY);

      // control: without the trigger the very same call notifies
      await dropFailureTriggers();
      await createOrder(db(), input(fx), {});
      await waitFor(() => received.length > 0);
      expect(received).toHaveLength(1);
    } finally {
      await client.end();
    }
  });
});
