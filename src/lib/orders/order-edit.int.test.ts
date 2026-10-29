import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { getEnv } from "@/lib/env";
import { setInitialStock } from "@/lib/stock/movements";
import { itemQty } from "@/lib/stock/test-fixtures";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { editPendingOrder } from "./order-edit";

const db = () => testDb();
let fx: Fx;

const unit = (productId: number, modifierIds: number[] = [], note = "") => ({ productId, modifierIds, note });
const edit = (orderId: number, over: Partial<Parameters<typeof editPendingOrder>[1]> = {}) =>
  editPendingOrder(db(), { orderId, userId: fx.userId, sector: null, removeItemIds: [], addUnits: [], ...over });
const order = async (id: number) => (await db().select().from(s.orders).where(eq(s.orders.id, id)))[0];
const items = (orderId: number) => db().select().from(s.orderItems).where(eq(s.orderItems.orderId, orderId)).orderBy(s.orderItems.id);
const events = (orderId: number) => db().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, orderId)).orderBy(s.orderEvents.id);

/** A controlled drink with `qty` units on hand. */
async function seedDrink(qty: number) {
  const [item] = await db().insert(s.stockItems).values({ name: "Coca 500", kind: "bebida", unit: "u", minQty: 0 }).returning({ id: s.stockItems.id });
  const [cat] = await db().insert(s.categories).values({ name: "Bebidas", slug: "bebidas" }).returning({ id: s.categories.id });
  const [p] = await db().insert(s.products).values({ categoryId: cat.id, name: "Coca-Cola", price: 2500_00, stockItemId: item.id }).returning({ id: s.products.id });
  const r = await setInitialStock(db(), { itemId: item.id, userId: fx.userId, milli: qty * 1000 });
  if (!r.ok) throw new Error(r.message);
  return { itemId: item.id, productId: p.id };
}

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

// Default order: ranchita+dips+sinCheddar (9700), ranchita+descuento (8200), melt (8800) = 26700 + fee.
describe("editPendingOrder", () => {
  it("agrega un producto y recalcula subtotal y total sin tocar el envío", async () => {
    const o = await placeWebOrder(fx);
    const before = await order(o.id);
    const r = await edit(o.id, { addUnits: [unit(fx.melt, [fx.sinCheddar], "sin sal")] });
    expect(r).toMatchObject({ ok: true, data: { orderId: o.id, subtotal: before.subtotal + 8800_00, total: before.total + 8800_00, menuChanged: false } });
    const after = await order(o.id);
    expect(after.deliveryFee).toBe(before.deliveryFee);
    expect(after.subtotal).toBe(before.subtotal + 8800_00);
    expect(after.total).toBe(after.subtotal + after.deliveryFee);
    const its = await items(o.id);
    expect(its).toHaveLength(4);
    expect(its[3]).toMatchObject({ nameSnapshot: "Melt simple", unitPriceSnapshot: 8800_00, notes: "sin sal", addonId: null });
    const mods = await db().select().from(s.orderItemModifiers).where(eq(s.orderItemModifiers.orderItemId, its[3].id));
    expect(mods).toHaveLength(1);
  });

  it("quita un producto, repone la bebida y recalcula", async () => {
    const drink = await seedDrink(5);
    const o = await placeWebOrder(fx, { units: [unit(fx.ranchita, [fx.dips]), unit(drink.productId)] });
    expect(await itemQty(drink.itemId)).toBe(4000);
    const its = await items(o.id);
    const coke = its.find((i) => i.productId === drink.productId)!;
    const before = await order(o.id);
    const r = await edit(o.id, { removeItemIds: [coke.id] });
    expect(r).toMatchObject({ ok: true, data: { subtotal: before.subtotal - 2500_00, total: before.total - 2500_00, menuChanged: false } });
    expect(await itemQty(drink.itemId)).toBe(5000);
    expect(await items(o.id)).toHaveLength(1);
    expect((await order(o.id)).subtotal).toBe(9700_00);
  });

  it("mantiene intactos los precios de los productos que quedan", async () => {
    const o = await placeWebOrder(fx);
    await db().update(s.products).set({ price: 1_00 }).where(eq(s.products.id, fx.ranchita));
    await db().update(s.modifiers).set({ priceDelta: 5_00 }).where(eq(s.modifiers.id, fx.dips));
    const r = await edit(o.id, { addUnits: [unit(fx.melt)] });
    expect(r).toMatchObject({ ok: true });
    expect((await order(o.id)).subtotal).toBe(26700_00 + 8800_00);
    expect((await items(o.id)).slice(0, 3).map((i) => i.unitPriceSnapshot)).toEqual([8500_00, 8500_00, 8800_00]);
  });

  it("rechaza dejar el pedido sin productos", async () => {
    const o = await placeWebOrder(fx);
    const before = await order(o.id);
    const all = (await items(o.id)).map((i) => i.id);
    expect(await edit(o.id, { removeItemIds: all })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await order(o.id)).toEqual(before);
    expect(await items(o.id)).toHaveLength(3);
    // ...but removing everything while adding something is fine.
    expect(await edit(o.id, { removeItemIds: all, addUnits: [unit(fx.melt)] })).toMatchObject({ ok: true, data: { subtotal: 8800_00 } });
  });

  it("rechaza si el pedido ya no está pendiente_aprobacion", async () => {
    const o = await placeWebOrder(fx);
    await db().update(s.orders).set({ status: "en_preparacion" }).where(eq(s.orders.id, o.id));
    expect(await edit(o.id, { addUnits: [unit(fx.melt)] })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await items(o.id)).toHaveLength(3);
  });

  it("rechaza ids de ítems de otro pedido y pedido inexistente", async () => {
    const a = await placeWebOrder(fx);
    const b = await placeWebOrder(fx);
    const foreign = (await items(b.id))[0].id;
    expect(await edit(a.id, { removeItemIds: [foreign], addUnits: [unit(fx.melt)] })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await items(b.id)).toHaveLength(3);
    expect(await items(a.id)).toHaveLength(3);
    expect(await edit(424242, { addUnits: [unit(fx.melt)] })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("rechaza una edición sin cambios o con unidades no disponibles", async () => {
    const o = await placeWebOrder(fx);
    expect(await edit(o.id)).toMatchObject({ ok: false, code: "VALIDATION" });
    const r = await edit(o.id, { addUnits: [unit(999_999)] });
    expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await items(o.id)).toHaveLength(3);
  });

  it("falta de stock no escribe nada", async () => {
    const drink = await seedDrink(1);
    const o = await placeWebOrder(fx);
    const beforeOrder = await order(o.id);
    const beforeItems = await items(o.id);
    const removeId = beforeItems[2].id;
    const r = await edit(o.id, { removeItemIds: [removeId], addUnits: [unit(drink.productId), unit(drink.productId)] });
    expect(r).toMatchObject({ ok: false, code: "OUT_OF_STOCK", productIds: [drink.productId], names: ["Coca-Cola"] });
    expect(await order(o.id)).toEqual(beforeOrder);
    expect(await items(o.id)).toEqual(beforeItems);
    expect(await itemQty(drink.itemId)).toBe(1000);
    expect(await events(o.id)).toHaveLength(1);
  });

  it("respeta el sector", async () => {
    const o = await placeWebOrder(fx); // delivery
    const r = await edit(o.id, { sector: "mostrador", addUnits: [unit(fx.melt)] });
    expect(r).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await items(o.id)).toHaveLength(3);
    expect(await edit(o.id, { sector: "delivery", addUnits: [unit(fx.melt)] })).toMatchObject({ ok: true });
  });

  it("escribe un order_events con from=to y la lista de cambios, y notifica \"updated\"", async () => {
    const o = await placeWebOrder(fx);
    const removed = (await items(o.id))[2];
    const client = new Client({ connectionString: getEnv().DATABASE_URL });
    await client.connect();
    await client.query("LISTEN orders_changed");
    const received: unknown[] = [];
    client.on("notification", (n) => received.push(JSON.parse(n.payload ?? "null")));
    try {
      const r = await edit(o.id, { removeItemIds: [removed.id], addUnits: [unit(fx.ranchita)] });
      expect(r).toMatchObject({ ok: true });
      const end = Date.now() + 3000;
      while (received.length < 1 && Date.now() < end) await new Promise((x) => setTimeout(x, 25));
      expect(received).toEqual([{ orderId: o.id, status: "pendiente_aprobacion", event: "updated" }]);
    } finally {
      await client.end();
    }
    const evs = await events(o.id);
    expect(evs).toHaveLength(2);
    expect(evs[1]).toMatchObject({ fromStatus: "pendiente_aprobacion", toStatus: "pendiente_aprobacion", userId: fx.userId });
    expect(evs[1].note).toContain("Melt simple");
    expect(evs[1].note).toContain("Ranchita simple");
    expect(evs[1].note!.length).toBeLessThanOrEqual(500);
  });
});
