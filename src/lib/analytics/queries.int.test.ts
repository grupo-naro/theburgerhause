import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { getLockedNames } from "./locked-names";
import type { Period } from "./period";
import { getHeatmap, getKpis, getSellers, getTopProducts } from "./queries";

const db = () => testDb();

// Week Mon 2026-11-02 .. Sun 2026-11-08; previous week 2026-10-26 .. 2026-11-01.
const WEEK: Period = { kind: "custom", from: "2026-11-02", to: "2026-11-08", prevFrom: "2026-10-26", prevTo: "2026-11-01", prevCutAt: null };

let seq = 0;
async function insertOrder(over: Partial<typeof s.orders.$inferInsert> = {}) {
  seq++;
  const total = over.total ?? 10_000;
  const [o] = await db()
    .insert(s.orders)
    .values({
      businessDate: "2026-11-04",
      number: seq,
      publicToken: `tok-${seq}`,
      channel: "counter",
      fulfillment: "takeaway",
      status: "entregado",
      paymentMethod: "cash",
      pagerNumber: seq,
      customerName: "X",
      subtotal: total,
      total,
      createdAt: new Date("2026-11-04T21:00:00-03:00"),
      ...over,
    })
    .returning();
  return o;
}

async function insertItem(orderId: number, it: { productId: number | null; name: string; price: number; deltas?: number[]; addonId?: number }) {
  const [row] = await db()
    .insert(s.orderItems)
    .values({ orderId, productId: it.productId, nameSnapshot: it.name, unitPriceSnapshot: it.price, addonId: it.addonId ?? null })
    .returning();
  for (const d of it.deltas ?? []) {
    await db().insert(s.orderItemModifiers).values({ orderItemId: row.id, nameSnapshot: "m", kitchenLabel: "M", kind: "add", priceDelta: d });
  }
}

let fx: { sofia: number; camila: number; burgers: number; drinks: number; doble: number; bacon: number; coca: number };

beforeEach(async () => {
  await resetDb();
  seq = 0;
  const users = await db()
    .insert(s.users)
    .values([
      { name: "Sofía", username: "sofia", passwordHash: "x", role: "cajera" },
      { name: "Camila", username: "camila", passwordHash: "x", role: "cajera" },
      { name: "Abril", username: "abril", passwordHash: "x", role: "cajera", active: false },
      { name: "Enzo", username: "enzo", passwordHash: "x", role: "encargado" },
    ])
    .returning({ id: s.users.id });
  const cats = await db()
    .insert(s.categories)
    .values([
      { name: "Burgers", slug: "burgers" },
      { name: "Bebidas", slug: "bebidas" },
    ])
    .returning({ id: s.categories.id });
  const prods = await db()
    .insert(s.products)
    .values([
      { categoryId: cats[0].id, name: "Doble", price: 7_000 },
      { categoryId: cats[0].id, name: "Bacon", price: 9_000 },
      { categoryId: cats[1].id, name: "Coca", price: 2_000 },
      { categoryId: cats[0].id, name: "Apagada", price: 1_000, active: false },
    ])
    .returning({ id: s.products.id });
  fx = { sofia: users[0].id, camila: users[1].id, burgers: cats[0].id, drinks: cats[1].id, doble: prods[0].id, bacon: prods[1].id, coca: prods[2].id };
});
afterAll(closeDb);

describe("getKpis", () => {
  it("kpis count only valid orders", async () => {
    await insertOrder({ total: 10_000 });
    await insertOrder({ total: 20_000 });
    await insertOrder({ total: 5_000, status: "en_preparacion" });
    await insertOrder({ total: 99_999, status: "pendiente_aprobacion", channel: "web" });
    await insertOrder({ total: 7_000, status: "cancelado" });
    await insertOrder({ total: 50_000, businessDate: "2026-11-09" }); // outside
    const { cur } = await getKpis(db(), WEEK);
    expect(cur).toEqual({ revenue: 35_000, orders: 3, avgTicket: 11_667, cancelledCount: 1, cancelledAmount: 7_000 });
  });

  it("previous range respects prevCutAt", async () => {
    const p: Period = { ...WEEK, prevCutAt: new Date("2026-11-01T21:00:00-03:00") };
    await insertOrder({ businessDate: "2026-11-01", createdAt: new Date("2026-11-01T20:00:00-03:00") });
    await insertOrder({ businessDate: "2026-11-01", createdAt: new Date("2026-11-01T23:00:00-03:00") });
    await insertOrder({ businessDate: "2026-11-01", status: "cancelado", createdAt: new Date("2026-11-01T23:30:00-03:00") });
    await insertOrder({ businessDate: "2026-10-28", createdAt: new Date("2026-10-28T23:00:00-03:00") });
    const { prev } = await getKpis(db(), p);
    expect(prev.orders).toBe(2);
    expect(prev.cancelledCount).toBe(0);
  });

  it("empty period", async () => {
    const zero = { revenue: 0, orders: 0, avgTicket: 0, cancelledCount: 0, cancelledAmount: 0 };
    expect(await getKpis(db(), WEEK)).toEqual({ cur: zero, prev: zero });
    expect(await getTopProducts(db(), WEEK, {})).toEqual([]);
    expect(await getHeatmap(db(), WEEK)).toEqual({ hours: [], cells: [], max: 0 });
    expect(await getSellers(db(), WEEK)).toEqual([]);
  });
});

describe("getHeatmap", () => {
  it("after-midnight order", async () => {
    await insertOrder({ businessDate: "2026-11-06", createdAt: new Date("2026-11-07T01:30:00-03:00") });
    await insertOrder({ businessDate: "2026-11-06", createdAt: new Date("2026-11-06T20:10:00-03:00") });
    await insertOrder({ businessDate: "2026-11-06", createdAt: new Date("2026-11-06T20:40:00-03:00") });
    await insertOrder({ businessDate: "2026-11-06", status: "cancelado", createdAt: new Date("2026-11-06T22:00:00-03:00") });
    const h = await getHeatmap(db(), WEEK, "06:00");
    expect(h.hours).toEqual([20, 1]);
    expect(h.cells).toContainEqual({ dow: 5, hour: 1, orders: 1 });
    expect(h.cells).toContainEqual({ dow: 5, hour: 20, orders: 2 });
    expect(h.max).toBe(2);
  });
});

describe("getTopProducts", () => {
  it("top products sum modifier deltas and order by units", async () => {
    const o = await insertOrder();
    await insertItem(o.id, { productId: fx.doble, name: "Doble", price: 7_000, deltas: [1_000] });
    await insertItem(o.id, { productId: fx.doble, name: "Doble", price: 7_000 });
    await insertItem(o.id, { productId: fx.doble, name: "Doble", price: 7_000 });
    await insertItem(o.id, { productId: fx.bacon, name: "Bacon", price: 9_000 });
    await insertItem(o.id, { productId: fx.bacon, name: "Bacon", price: 9_000 });
    await insertItem(o.id, { productId: fx.coca, name: "Coca", price: 2_000 });
    await insertItem(o.id, { productId: null, name: "Vieja", price: 3_000 });
    const cancelled = await insertOrder({ status: "cancelado" });
    await insertItem(cancelled.id, { productId: fx.coca, name: "Coca", price: 2_000 });
    await insertItem(cancelled.id, { productId: fx.coca, name: "Coca", price: 2_000 });

    const all = await getTopProducts(db(), WEEK, {});
    expect(all.slice(0, 2)).toMatchObject([
      { name: "Doble", units: 3, revenue: 22_000 },
      { name: "Bacon", units: 2, revenue: 18_000 },
    ]);
    expect(all).toContainEqual(expect.objectContaining({ name: "Vieja", units: 1, revenue: 3_000 }));
    expect(all.find((r) => r.name === "Coca")?.units).toBe(1);

    expect(await getTopProducts(db(), WEEK, { categoryId: fx.drinks })).toMatchObject([{ name: "Coca", units: 1 }]);
    expect(await getTopProducts(db(), WEEK, { limit: 1 })).toHaveLength(1);
  });

  it("uses the current product name", async () => {
    const o = await insertOrder();
    await insertItem(o.id, { productId: fx.doble, name: "Doble viejo nombre", price: 7_000 });
    expect((await getTopProducts(db(), WEEK, {}))[0].name).toBe("Doble");
  });
});

describe("getSellers", () => {
  it("sellers attribute by approved_by and count confirmed add-ons on valid orders", async () => {
    const o1 = await insertOrder({ approvedBy: fx.sofia, total: 10_000 });
    await insertOrder({ approvedBy: fx.sofia, total: 20_000 });
    await insertOrder({ approvedBy: fx.camila, total: 12_000 });
    await insertOrder({ approvedBy: null, total: 4_000 });
    const dead = await insertOrder({ approvedBy: fx.camila, status: "cancelado" });
    await db().insert(s.orderAddons).values([
      { orderId: o1.id, seq: 1, status: "confirmado", units: [], subtotal: 1_000, confirmedBy: fx.sofia },
      { orderId: o1.id, seq: 2, status: "cancelado", units: [], subtotal: 1_000, confirmedBy: fx.sofia },
      { orderId: dead.id, seq: 1, status: "confirmado", units: [], subtotal: 1_000, confirmedBy: fx.camila },
    ]);
    const rows = await getSellers(db(), WEEK);
    expect(rows).toEqual([
      { userId: fx.sofia, name: "Sofía", orders: 2, revenue: 30_000, avgTicket: 15_000, addons: 1 },
      { userId: fx.camila, name: "Camila", orders: 1, revenue: 12_000, avgTicket: 12_000, addons: 0 },
      { userId: null, name: "Sin asignar", orders: 1, revenue: 4_000, avgTicket: 4_000, addons: 0 },
    ]);
  });

  it("a user who only confirmed add-ons still appears", async () => {
    const o = await insertOrder({ approvedBy: fx.sofia });
    await db().insert(s.orderAddons).values({ orderId: o.id, seq: 1, status: "confirmado", units: [], subtotal: 1_000, confirmedBy: fx.camila });
    expect(await getSellers(db(), WEEK)).toContainEqual({ userId: fx.camila, name: "Camila", orders: 0, revenue: 0, avgTicket: 0, addons: 1 });
  });
});

describe("getLockedNames", () => {
  it("locked names are alphabetical and ignore sales", async () => {
    await insertOrder({ approvedBy: fx.camila, total: 90_000 });
    await insertOrder({ approvedBy: fx.sofia, total: 1_000 });
    expect(await getLockedNames(db(), {})).toEqual({ products: ["Bacon", "Coca", "Doble"], sellers: ["Camila", "Sofía"] });
    expect((await getLockedNames(db(), { categoryId: fx.drinks })).products).toEqual(["Coca"]);
  });
});
