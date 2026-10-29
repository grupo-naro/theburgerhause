import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { loadMenu } from "@/lib/menu/public";
import { approveOrder } from "@/lib/orders/approve-order";
import { cancelOrder } from "@/lib/orders/cancel-order";
import { createCounterOrder } from "@/lib/orders/create-counter-order";
import { createOrder } from "@/lib/orders/create-order";
import { rejectOrder } from "@/lib/orders/reject-order";
import { seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { registerIngreso, setInitialStock } from "./movements";
import { adjustStockForOrder, outOfStockMessage, returnStockForOrder } from "./sales";
import { itemQty, key, movementsOf, productFlags } from "./test-fixtures";

const db = () => testDb();

type StockSaleFx = Fx & {
  coca: number;
  sprite: number;
  carne: number;
  inactive: number;
  cocaProduct: number;
  spriteProduct: number;
  /** Product linked to a raw-material item: never controlled. */
  carneProduct: number;
  /** Product linked to an INACTIVE drink item: never controlled. */
  inactiveProduct: number;
};

let fx: StockSaleFx;

async function seed(): Promise<StockSaleFx> {
  const base = await seedMenuAndStaff();
  const d = db();
  const [coca, sprite, carne, inactive] = await d
    .insert(s.stockItems)
    .values([
      { name: "Coca-Cola 500 ml", kind: "bebida", unit: "u", minQty: 0 },
      { name: "Sprite 500 ml", kind: "bebida", unit: "u", minQty: 0 },
      { name: "Carne picada", kind: "materia_prima", unit: "kg", minQty: 0 },
      { name: "Fanta vieja", kind: "bebida", unit: "u", minQty: 0, active: false },
    ])
    .returning({ id: s.stockItems.id });
  const [cat] = await d.insert(s.categories).values({ name: "Bebidas", slug: "bebidas" }).returning({ id: s.categories.id });
  const [cocaProduct, spriteProduct, carneProduct, inactiveProduct] = await d
    .insert(s.products)
    .values([
      { categoryId: cat.id, name: "Coca-Cola", price: 2500_00, stockItemId: coca.id },
      { categoryId: cat.id, name: "Sprite", price: 2400_00, stockItemId: sprite.id },
      { categoryId: cat.id, name: "Hamburguesa casera", price: 9000_00, stockItemId: carne.id },
      { categoryId: cat.id, name: "Fanta", price: 2300_00, stockItemId: inactive.id },
    ])
    .returning({ id: s.products.id });
  return {
    ...base,
    coca: coca.id,
    sprite: sprite.id,
    carne: carne.id,
    inactive: inactive.id,
    cocaProduct: cocaProduct.id,
    spriteProduct: spriteProduct.id,
    carneProduct: carneProduct.id,
    inactiveProduct: inactiveProduct.id,
  };
}

const initial = async (itemId: number, units: number) => {
  const r = await setInitialStock(db(), { itemId, userId: fx.userId, milli: units * 1000 });
  if (!r.ok) throw new Error(r.message);
};

const unit = (productId: number) => ({ productId, modifierIds: [], note: "" });

const webInput = (productIds: number[], idempotencyKey: string = randomUUID()) => ({
  idempotencyKey,
  units: productIds.map(unit),
  customer: { name: "Juana Pérez", whatsapp: "+54 9 11 5555-1234" },
  fulfillment: "takeaway",
  paymentMethod: "cash",
  bh_ref: "",
});

const counterInput = (productIds: number[], pagerNumber = 7, idempotencyKey: string = randomUUID()) => ({
  idempotencyKey,
  units: productIds.map(unit),
  paymentMethod: "cash" as const,
  pagerNumber,
  userId: fx.userId,
  stationId: fx.stationId,
});

async function orderIdOf(number: number): Promise<number> {
  const rows = await db().select({ id: s.orders.id, number: s.orders.number }).from(s.orders);
  return rows.find((r) => r.number === number)!.id;
}

async function webOrder(productIds: number[]): Promise<number> {
  const r = await createOrder(db(), webInput(productIds));
  if (!r.ok) throw new Error(`web order failed: ${r.code}`);
  return orderIdOf(r.data.number);
}

const salesOf = async (itemId: number) => (await movementsOf(itemId)).filter((m) => m.kind === "venta" || m.kind === "devolucion");
const orderCount = async () => (await db().select({ id: s.orders.id }).from(s.orders)).length;
const menuProductIds = async () => (await loadMenu(db())).categories.flatMap((c) => c.products.map((p) => p.id));

beforeEach(async () => {
  await resetDb();
  fx = await seed();
});
afterAll(closeDb);

describe("outOfStockMessage", () => {
  it("names one product (singular) or several (plural)", () => {
    expect(outOfStockMessage(["Coca-Cola"])).toBe("Se agotó Coca-Cola. Sacala del pedido para continuar.");
    expect(outOfStockMessage(["Coca-Cola", "Sprite"])).toBe("Se agotaron Coca-Cola y Sprite. Sacalas del pedido para continuar.");
    expect(outOfStockMessage(["A", "B", "C"])).toBe("Se agotaron A, B y C. Sacalas del pedido para continuar.");
  });
});

describe("web order reserves linked drinks when it is created", () => {
  it("2 Cocas take 2 units off, one venta movement tied to the order", async () => {
    await initial(fx.coca, 5);
    const orderId = await webOrder([fx.cocaProduct, fx.cocaProduct, fx.ranchita]);
    expect(await itemQty(fx.coca)).toBe(3000);
    const sales = await salesOf(fx.coca);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ kind: "venta", qtyDelta: -2000, orderId, userId: null });
  });

  it("refuses with OUT_OF_STOCK when the order needs more than there is: no order, no movement", async () => {
    await initial(fx.coca, 1);
    await initial(fx.sprite, 5);
    const r = await createOrder(db(), webInput([fx.cocaProduct, fx.cocaProduct, fx.spriteProduct]));
    expect(r).toEqual({
      ok: false,
      code: "OUT_OF_STOCK",
      message: "Se agotó Coca-Cola. Sacala del pedido para continuar.",
      productIds: [fx.cocaProduct],
      names: ["Coca-Cola"],
    });
    expect(await orderCount()).toBe(0);
    expect(await db().select().from(s.orderItems)).toHaveLength(0);
    expect(await db().select().from(s.dailyCounters)).toHaveLength(0);
    expect(await itemQty(fx.coca)).toBe(1000);
    expect(await itemQty(fx.sprite)).toBe(5000);
    expect(await salesOf(fx.coca)).toHaveLength(0);
    expect(await salesOf(fx.sprite)).toHaveLength(0);
  });

  it("lists every product that ran out (plural message)", async () => {
    await initial(fx.coca, 0);
    await initial(fx.sprite, 0);
    const r = await createOrder(db(), webInput([fx.spriteProduct, fx.cocaProduct]));
    expect(r).toMatchObject({
      ok: false,
      code: "OUT_OF_STOCK",
      message: "Se agotaron Coca-Cola y Sprite. Sacalas del pedido para continuar.",
      names: ["Coca-Cola", "Sprite"],
    });
    if (!r.ok) expect([...(r.productIds ?? [])].sort()).toEqual([fx.cocaProduct, fx.spriteProduct].sort());
  });

  it("the same idempotency key deducts only once", async () => {
    await initial(fx.coca, 5);
    const k = randomUUID();
    const first = await createOrder(db(), webInput([fx.cocaProduct, fx.cocaProduct], k));
    const again = await createOrder(db(), webInput([fx.cocaProduct, fx.cocaProduct], k));
    expect(first).toMatchObject({ ok: true, data: { duplicate: false } });
    expect(again).toMatchObject({ ok: true, data: { duplicate: true } });
    const [a, b] = await Promise.all([
      createOrder(db(), webInput([fx.cocaProduct], "11111111-1111-4111-8111-111111111111")),
      createOrder(db(), webInput([fx.cocaProduct], "11111111-1111-4111-8111-111111111111")),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(await orderCount()).toBe(2);
    expect(await itemQty(fx.coca)).toBe(2000);
    expect(await salesOf(fx.coca)).toHaveLength(2);
  });

  it("a duplicate replay still answers with the first order even after the drink ran out", async () => {
    await initial(fx.coca, 1);
    const k = randomUUID();
    expect(await createOrder(db(), webInput([fx.cocaProduct], k))).toMatchObject({ ok: true });
    expect(await createOrder(db(), webInput([fx.cocaProduct], k))).toMatchObject({ ok: true, data: { duplicate: true } });
    expect(await itemQty(fx.coca)).toBe(0);
  });

  it("two concurrent orders for the last unit: exactly one wins, stock never negative", async () => {
    await initial(fx.coca, 1);
    const results = await Promise.all([
      createOrder(db(), webInput([fx.cocaProduct])),
      createOrder(db(), webInput([fx.cocaProduct])),
      createCounterOrder(db(), counterInput([fx.cocaProduct], 3)),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const losers = results.filter((r) => !r.ok);
    expect(losers).toHaveLength(2);
    for (const l of losers) expect(l).toMatchObject({ code: "OUT_OF_STOCK" });
    expect(await orderCount()).toBe(1);
    expect(await itemQty(fx.coca)).toBe(0);
  });

  it("products without a link, linked to raw material or to an inactive item sell as today", async () => {
    await initial(fx.carne, 0);
    const orderId = await webOrder([fx.ranchita, fx.carneProduct, fx.inactiveProduct]);
    expect(orderId).toBeGreaterThan(0);
    expect(await db().select().from(s.stockMovements).where(eq(s.stockMovements.kind, "venta"))).toHaveLength(0);
    expect(await itemQty(fx.carne)).toBe(0);
    expect(await itemQty(fx.inactive)).toBe(0);
  });
});

describe("counter sale deducts when the sale is confirmed", () => {
  it("takes the units off with the cashier as author", async () => {
    await initial(fx.coca, 4);
    const r = await createCounterOrder(db(), counterInput([fx.cocaProduct, fx.cocaProduct, fx.cocaProduct]));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(await itemQty(fx.coca)).toBe(1000);
    const [sale] = await salesOf(fx.coca);
    expect(sale).toMatchObject({ kind: "venta", qtyDelta: -3000, orderId: r.data.orderId, userId: fx.userId });
  });

  it("refuses OUT_OF_STOCK without creating the sale, the print jobs or holding the pager", async () => {
    await initial(fx.coca, 0);
    const r = await createCounterOrder(db(), counterInput([fx.cocaProduct, fx.ranchita], 9));
    expect(r).toMatchObject({ ok: false, code: "OUT_OF_STOCK", message: "Se agotó Coca-Cola. Sacala del pedido para continuar." });
    expect(await orderCount()).toBe(0);
    expect(await db().select().from(s.printJobs)).toHaveLength(0);
    // The pager is free: the same pager sells right away without the drink.
    expect(await createCounterOrder(db(), counterInput([fx.ranchita], 9))).toMatchObject({ ok: true });
  });

  it("the same idempotency key deducts only once", async () => {
    await initial(fx.coca, 4);
    const k = randomUUID();
    expect(await createCounterOrder(db(), counterInput([fx.cocaProduct], 5, k))).toMatchObject({ ok: true, data: { duplicate: false } });
    expect(await createCounterOrder(db(), counterInput([fx.cocaProduct], 5, k))).toMatchObject({ ok: true, data: { duplicate: true } });
    expect(await itemQty(fx.coca)).toBe(3000);
  });
});

describe("returns on rejection and cancellation, exactly once", () => {
  it("rejecting a web order gives the drinks back", async () => {
    await initial(fx.coca, 5);
    const orderId = await webOrder([fx.cocaProduct, fx.cocaProduct]);
    expect(await rejectOrder(db(), { orderId, userId: fx.userId, reason: "Sin cadete", sector: null })).toMatchObject({ ok: true });
    expect(await itemQty(fx.coca)).toBe(5000);
    const sales = await salesOf(fx.coca);
    expect(sales.map((m) => [m.kind, m.qtyDelta, m.orderId, m.userId])).toEqual([
      ["venta", -2000, orderId, null],
      ["devolucion", 2000, orderId, fx.userId],
    ]);
  });

  it("cancelling after approval gives the drinks back", async () => {
    await initial(fx.coca, 5);
    const orderId = await webOrder([fx.cocaProduct, fx.cocaProduct]);
    expect(
      await approveOrder(db(), { orderId, userId: fx.userId, stationId: fx.stationId, paymentVerified: true, sector: null }),
    ).toMatchObject({ ok: true });
    expect(await itemQty(fx.coca)).toBe(3000);
    expect(await cancelOrder(db(), { orderId, userId: fx.userId, reason: "Cliente canceló", sector: null })).toMatchObject({ ok: true });
    expect(await itemQty(fx.coca)).toBe(5000);
  });

  it("cancelling a counter sale gives the drinks back", async () => {
    await initial(fx.coca, 2);
    const r = await createCounterOrder(db(), counterInput([fx.cocaProduct, fx.cocaProduct]));
    if (!r.ok) throw new Error(r.code);
    expect(await itemQty(fx.coca)).toBe(0);
    expect(await cancelOrder(db(), { orderId: r.data.orderId, userId: fx.userId, reason: "Error de carga", sector: null })).toMatchObject({ ok: true });
    expect(await itemQty(fx.coca)).toBe(2000);
  });

  it("rejected and then cancelled (or cancelled twice) returns only once", async () => {
    await initial(fx.coca, 5);
    const orderId = await webOrder([fx.cocaProduct]);
    expect(await rejectOrder(db(), { orderId, userId: fx.userId, reason: "Sin cadete", sector: null })).toMatchObject({ ok: true });
    expect(await cancelOrder(db(), { orderId, userId: fx.userId, reason: "Otra vez", sector: null })).toMatchObject({ ok: false });
    expect(await rejectOrder(db(), { orderId, userId: fx.userId, reason: "Otra vez", sector: null })).toMatchObject({ ok: false });
    expect(await itemQty(fx.coca)).toBe(5000);
    expect((await salesOf(fx.coca)).filter((m) => m.kind === "devolucion")).toHaveLength(1);
  });

  it("concurrent reject and cancel of the same order return once", async () => {
    await initial(fx.coca, 5);
    const orderId = await webOrder([fx.cocaProduct, fx.cocaProduct]);
    await Promise.all([
      rejectOrder(db(), { orderId, userId: fx.userId, reason: "Sin cadete", sector: null }),
      rejectOrder(db(), { orderId, userId: fx.userId, reason: "Sin cadete", sector: null }),
    ]);
    expect(await itemQty(fx.coca)).toBe(5000);
    expect((await salesOf(fx.coca)).filter((m) => m.kind === "devolucion")).toHaveLength(1);
  });

  it("returnStockForOrder itself is idempotent per order/item", async () => {
    await initial(fx.coca, 5);
    const orderId = await webOrder([fx.cocaProduct]);
    await db().transaction((tx) => returnStockForOrder(tx, { orderId, userId: null }));
    await db().transaction((tx) => returnStockForOrder(tx, { orderId, userId: null }));
    expect(await itemQty(fx.coca)).toBe(5000);
    expect((await salesOf(fx.coca)).filter((m) => m.kind === "devolucion")).toHaveLength(1);
  });

  it("an order without controlled drinks rejects and cancels as today", async () => {
    const orderId = await webOrder([fx.ranchita]);
    expect(await rejectOrder(db(), { orderId, userId: fx.userId, reason: "Sin cadete", sector: null })).toEqual({
      ok: true,
      data: { orderId, status: "cancelado" },
    });
    expect(await db().select().from(s.stockMovements).where(eq(s.stockMovements.orderId, orderId))).toHaveLength(0);
  });
});

describe("order adjustments (ajuste_pedido)", () => {
  const adjustmentsOf = async (itemId: number) => (await movementsOf(itemId)).filter((m) => m.kind === "ajuste_pedido");
  const adjust = (orderId: number, add: number[], remove: number[]) =>
    db().transaction((tx) =>
      adjustStockForOrder(tx, { orderId, add: add.map((productId) => ({ productId })), remove: remove.map((productId) => ({ productId })), userId: fx.userId }),
    );

  it("adjustStockForOrder agrega una bebida ya vendida sin chocar con el índice único", async () => {
    await initial(fx.coca, 5);
    const orderId = await webOrder([fx.cocaProduct]);
    expect(await adjust(orderId, [fx.cocaProduct], [])).toMatchObject({ ok: true });
    expect(await itemQty(fx.coca)).toBe(3000);
    expect(await adjust(orderId, [fx.cocaProduct], [])).toMatchObject({ ok: true });
    expect(await itemQty(fx.coca)).toBe(2000);
    const rows = (await movementsOf(fx.coca)).filter((m) => m.orderId === orderId);
    expect(rows.map((m) => [m.kind, m.qtyDelta])).toEqual([
      ["venta", -1000],
      ["ajuste_pedido", -1000],
      ["ajuste_pedido", -1000],
    ]);
  });

  it("adjustStockForOrder repone al quitar", async () => {
    await initial(fx.coca, 5);
    const orderId = await webOrder([fx.cocaProduct]);
    expect(await adjust(orderId, [], [fx.cocaProduct])).toMatchObject({ ok: true });
    expect(await itemQty(fx.coca)).toBe(5000);
    expect((await adjustmentsOf(fx.coca)).map((m) => m.qtyDelta)).toEqual([1000]);
  });

  it("adjustStockForOrder con faltante no escribe nada", async () => {
    await initial(fx.coca, 1);
    await initial(fx.sprite, 5);
    const orderId = await webOrder([fx.cocaProduct]);
    const r = await adjust(orderId, [fx.cocaProduct, fx.spriteProduct], []);
    expect(r).toMatchObject({ ok: false, code: "OUT_OF_STOCK", productIds: [fx.cocaProduct] });
    expect(await adjustmentsOf(fx.coca)).toHaveLength(0);
    expect(await adjustmentsOf(fx.sprite)).toHaveLength(0);
    expect(await itemQty(fx.sprite)).toBe(5000);
  });

  it("adjustStockForOrder netea agregar y quitar del mismo artículo", async () => {
    await initial(fx.coca, 1);
    const orderId = await webOrder([fx.cocaProduct]);
    expect(await adjust(orderId, [fx.cocaProduct], [fx.cocaProduct])).toMatchObject({ ok: true });
    expect(await adjustmentsOf(fx.coca)).toHaveLength(0);
    expect(await itemQty(fx.coca)).toBe(0);
  });

  it("returnStockForOrder devuelve el neto tras ajustes", async () => {
    await initial(fx.coca, 5);
    const orderId = await webOrder([fx.cocaProduct]);
    await adjust(orderId, [fx.cocaProduct, fx.cocaProduct], []);
    expect(await itemQty(fx.coca)).toBe(2000);
    await db().transaction((tx) => returnStockForOrder(tx, { orderId, userId: fx.userId }));
    expect(await itemQty(fx.coca)).toBe(5000);
    expect((await salesOf(fx.coca)).filter((m) => m.kind === "devolucion").map((m) => m.qtyDelta)).toEqual([3000]);
  });

  it("returnStockForOrder sigue siendo idempotente", async () => {
    await initial(fx.coca, 5);
    const orderId = await webOrder([fx.cocaProduct]);
    await adjust(orderId, [fx.cocaProduct], []);
    await db().transaction((tx) => returnStockForOrder(tx, { orderId, userId: null }));
    await db().transaction((tx) => returnStockForOrder(tx, { orderId, userId: null }));
    expect(await itemQty(fx.coca)).toBe(5000);
    expect((await salesOf(fx.coca)).filter((m) => m.kind === "devolucion")).toHaveLength(1);
  });

  it("returnStockForOrder no escribe si el neto vendido es cero", async () => {
    await initial(fx.coca, 5);
    const orderId = await webOrder([fx.cocaProduct]);
    await adjust(orderId, [], [fx.cocaProduct]);
    await db().transaction((tx) => returnStockForOrder(tx, { orderId, userId: null }));
    expect(await itemQty(fx.coca)).toBe(5000);
    expect((await salesOf(fx.coca)).filter((m) => m.kind === "devolucion")).toHaveLength(0);
  });
});

describe("stock pause and availability", () => {
  it("at zero the drink is stock-paused and leaves the menu (web and POS); replenishing brings it back", async () => {
    await initial(fx.coca, 1);
    expect(await menuProductIds()).toContain(fx.cocaProduct);
    await webOrder([fx.cocaProduct]);
    expect(await productFlags(fx.cocaProduct)).toEqual({ active: true, stockPaused: true });
    expect(await menuProductIds()).not.toContain(fx.cocaProduct);
    expect(await menuProductIds()).toContain(fx.spriteProduct);

    const r = await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 6000, idempotencyKey: key(1) });
    expect(r.ok).toBe(true);
    expect(await productFlags(fx.cocaProduct)).toEqual({ active: true, stockPaused: false });
    expect(await menuProductIds()).toContain(fx.cocaProduct);
  });

  it("a returned drink lifts the stock pause", async () => {
    await initial(fx.coca, 1);
    const orderId = await webOrder([fx.cocaProduct]);
    expect((await productFlags(fx.cocaProduct)).stockPaused).toBe(true);
    await rejectOrder(db(), { orderId, userId: fx.userId, reason: "Sin cadete", sector: null });
    expect(await productFlags(fx.cocaProduct)).toEqual({ active: true, stockPaused: false });
  });

  it("a manual pause is not lifted by replenishing", async () => {
    await initial(fx.coca, 1);
    await webOrder([fx.cocaProduct]);
    await db().update(s.products).set({ active: false }).where(eq(s.products.id, fx.cocaProduct));
    await registerIngreso(db(), { itemId: fx.coca, userId: fx.userId, milli: 6000, idempotencyKey: key(2) });
    expect(await productFlags(fx.cocaProduct)).toEqual({ active: false, stockPaused: false });
    expect(await menuProductIds()).not.toContain(fx.cocaProduct);
  });

  it("a stock-paused product cannot be ordered (OUT_OF_STOCK), on the web or at the counter", async () => {
    await initial(fx.coca, 0);
    const paused = await db()
      .select({ p: s.products.stockPaused })
      .from(s.products)
      .where(and(eq(s.products.id, fx.cocaProduct), eq(s.products.stockPaused, true)));
    expect(paused).toHaveLength(1);
    expect(await createOrder(db(), webInput([fx.cocaProduct]))).toMatchObject({ ok: false, code: "OUT_OF_STOCK" });
    expect(await createCounterOrder(db(), counterInput([fx.cocaProduct]))).toMatchObject({ ok: false, code: "OUT_OF_STOCK" });
  });

  it("reports when the menu changed so the caller can refresh its cache", async () => {
    await initial(fx.coca, 2);
    const a = await createOrder(db(), webInput([fx.cocaProduct]));
    expect(a.ok && a.data.menuChanged).toBeFalsy();
    const b = await createOrder(db(), webInput([fx.cocaProduct]));
    expect(b.ok && b.data.menuChanged).toBe(true);
    if (!b.ok) return;
    const orderId = await orderIdOf(b.data.number);
    const rej = await rejectOrder(db(), { orderId, userId: fx.userId, reason: "Sin cadete", sector: null });
    expect(rej.ok && rej.data.menuChanged).toBe(true);
  });
});
