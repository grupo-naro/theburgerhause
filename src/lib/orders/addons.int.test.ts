import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { setInitialStock } from "@/lib/stock/movements";
import { itemQty } from "@/lib/stock/test-fixtures";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { addOrderAddon, cancelAddon, confirmAddon } from "./addons";
import { approveOrder } from "./approve-order";
import { cancelOrder } from "./cancel-order";
import { createCounterOrder } from "./create-counter-order";
import { markReady } from "./dispatch";

const db = () => testDb();
let fx: Fx;

const unit = (productId: number, modifierIds: number[] = [], note = "") => ({ productId, modifierIds, note });
const order = async (id: number) => (await db().select().from(s.orders).where(eq(s.orders.id, id)))[0];
const items = (orderId: number) => db().select().from(s.orderItems).where(eq(s.orderItems.orderId, orderId)).orderBy(s.orderItems.id);
const events = (orderId: number) => db().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, orderId)).orderBy(s.orderEvents.id);
const jobs = (orderId: number) => db().select().from(s.printJobs).where(eq(s.printJobs.orderId, orderId)).orderBy(s.printJobs.id);
const addon = async (id: number) => (await db().select().from(s.orderAddons).where(eq(s.orderAddons.id, id)))[0];

async function seedDrink(qty: number) {
  const [item] = await db().insert(s.stockItems).values({ name: "Coca 500", kind: "bebida", unit: "u", minQty: 0 }).returning({ id: s.stockItems.id });
  const [cat] = await db().insert(s.categories).values({ name: "Bebidas", slug: "bebidas" }).returning({ id: s.categories.id });
  const [p] = await db().insert(s.products).values({ categoryId: cat.id, name: "Coca-Cola", price: 2500_00, stockItemId: item.id }).returning({ id: s.products.id });
  const r = await setInitialStock(db(), { itemId: item.id, userId: fx.userId, milli: qty * 1000 });
  if (!r.ok) throw new Error(r.message);
  return { itemId: item.id, productId: p.id };
}

/** A web order approved into en_preparacion. */
async function prepared(paymentMethod: "cash" | "transfer", units?: unknown[]) {
  const o = await placeWebOrder(fx, { paymentMethod, units });
  const r = await approveOrder(db(), { orderId: o.id, userId: fx.userId, stationId: fx.otherStationId, paymentVerified: true, sector: null });
  if (!r.ok) throw new Error(r.message);
  return o.id;
}

async function counterOrder(units: ReturnType<typeof unit>[]) {
  const r = await createCounterOrder(db(), {
    idempotencyKey: randomUUID(),
    units,
    paymentMethod: "cash" as const,
    pagerNumber: 7,
    userId: fx.userId,
    stationId: fx.stationId,
  });
  if (!r.ok) throw new Error(r.message);
  return r.data.orderId;
}

const add = (orderId: number, units: ReturnType<typeof unit>[], over: Partial<Parameters<typeof addOrderAddon>[1]> = {}) =>
  addOrderAddon(db(), { orderId, userId: fx.userId, sector: null, units, idempotencyKey: randomUUID(), ...over });
const confirm = (addonId: number, over: Partial<Parameters<typeof confirmAddon>[1]> = {}) =>
  confirmAddon(db(), { addonId, userId: fx.userId, sector: null, paymentVerified: true, ...over });

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("addons", () => {
  it("efectivo web: confirma en el acto, suma al total, imprime additional y descuenta bebida", async () => {
    const drink = await seedDrink(5);
    const id = await prepared("cash");
    const before = await order(id);
    const jobsBefore = (await jobs(id)).length;
    const r = await add(id, [unit(drink.productId), unit(fx.melt)]);
    expect(r).toMatchObject({ ok: true, data: { seq: 1, status: "confirmado", subtotal: 2500_00 + 8800_00, menuChanged: false } });
    const after = await order(id);
    expect(after.subtotal).toBe(before.subtotal + 11300_00);
    expect(after.total).toBe(before.total + 11300_00);
    expect(after.deliveryFee).toBe(before.deliveryFee);
    expect(after.paymentStatus).toBe(before.paymentStatus);
    expect(await itemQty(drink.itemId)).toBe(4000);
    const newJobs = (await jobs(id)).slice(jobsBefore);
    expect(newJobs.map((j) => j.type)).toContain("additional");
    const its = await items(id);
    expect(its).toHaveLength(5);
    const a = await addon(r.ok ? r.data.addonId : 0);
    expect(its.filter((i) => i.addonId === a.id)).toHaveLength(2);
    expect(a).toMatchObject({ status: "confirmado", confirmedBy: fx.userId });
    const evs = await events(id);
    const last = evs[evs.length - 1];
    expect(last).toMatchObject({ fromStatus: "en_preparacion", toStatus: "en_preparacion" });
    expect(last.note).toContain("Adicional 1");
  });

  it("mostrador: confirma en el acto sin tocar paymentStatus", async () => {
    const id = await counterOrder([unit(fx.melt)]);
    const before = await order(id);
    const r = await add(id, [unit(fx.ranchita)]);
    expect(r).toMatchObject({ ok: true, data: { status: "confirmado", subtotal: 8500_00 } });
    const after = await order(id);
    expect(after.paymentStatus).toBe(before.paymentStatus);
    expect(after.total).toBe(before.total + 8500_00);
  });

  it("transferencia: queda pendiente_pago sin ítems, sin stock, sin ticket y total sin cambios", async () => {
    const drink = await seedDrink(5);
    const id = await prepared("transfer");
    const before = await order(id);
    const itemsBefore = await items(id);
    const jobsBefore = await jobs(id);
    const r = await add(id, [unit(drink.productId)]);
    expect(r).toMatchObject({ ok: true, data: { seq: 1, status: "pendiente_pago", subtotal: 2500_00 } });
    expect(await order(id)).toEqual(before);
    expect(await items(id)).toEqual(itemsBefore);
    expect(await jobs(id)).toEqual(jobsBefore);
    expect(await itemQty(drink.itemId)).toBe(5000);
    const a = await addon(r.ok ? r.data.addonId : 0);
    expect(a.status).toBe("pendiente_pago");
    expect(Array.isArray(a.units)).toBe(true);
  });

  it("confirmAddon exige paymentVerified", async () => {
    const id = await prepared("transfer");
    const r = await add(id, [unit(fx.melt)]);
    if (!r.ok) throw new Error(r.message);
    expect(await confirm(r.data.addonId, { paymentVerified: false })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect((await addon(r.data.addonId)).status).toBe("pendiente_pago");
  });

  it("confirmAddon inserta ítems con addon_id, suma el total y encola additional", async () => {
    const id = await prepared("transfer");
    const before = await order(id);
    const jobsBefore = (await jobs(id)).length;
    const r = await add(id, [unit(fx.melt, [fx.sinCheddar], "sin sal"), unit(fx.ranchita, [fx.dips])]);
    if (!r.ok) throw new Error(r.message);
    const c = await confirm(r.data.addonId);
    expect(c).toMatchObject({ ok: true, data: { addonId: r.data.addonId, seq: 1, menuChanged: false } });
    const after = await order(id);
    expect(after.total).toBe(before.total + 8800_00 + 9700_00);
    expect(after.subtotal).toBe(before.subtotal + 8800_00 + 9700_00);
    expect(after.paymentStatus).toBe(before.paymentStatus);
    const mine = (await items(id)).filter((i) => i.addonId === r.data.addonId);
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({ nameSnapshot: "Melt simple", notes: "sin sal" });
    expect((await jobs(id)).slice(jobsBefore).map((j) => j.type)).toContain("additional");
    expect(await addon(r.data.addonId)).toMatchObject({ status: "confirmado", confirmedBy: fx.userId });
  });

  it("confirmAddon dos veces no descuenta dos veces", async () => {
    const drink = await seedDrink(5);
    const id = await prepared("transfer");
    const r = await add(id, [unit(drink.productId)]);
    if (!r.ok) throw new Error(r.message);
    expect(await confirm(r.data.addonId)).toMatchObject({ ok: true });
    expect(await confirm(r.data.addonId)).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await itemQty(drink.itemId)).toBe(4000);
  });

  it("mismo idempotencyKey devuelve el mismo adicional", async () => {
    const drink = await seedDrink(5);
    const id = await prepared("cash");
    const key = randomUUID();
    const a = await add(id, [unit(drink.productId)], { idempotencyKey: key });
    const b = await add(id, [unit(drink.productId)], { idempotencyKey: key });
    expect(a.ok && b.ok && a.data.addonId === b.data.addonId).toBe(true);
    expect(await db().select().from(s.orderAddons).where(eq(s.orderAddons.orderId, id))).toHaveLength(1);
    expect(await itemQty(drink.itemId)).toBe(4000);
  });

  it("varios adicionales numeran 1, 2", async () => {
    const id = await prepared("cash");
    const a = await add(id, [unit(fx.melt)]);
    const b = await add(id, [unit(fx.melt)]);
    expect(a).toMatchObject({ ok: true, data: { seq: 1 } });
    expect(b).toMatchObject({ ok: true, data: { seq: 2 } });
  });

  it("misma bebida en dos adicionales no choca con el índice de stock", async () => {
    const drink = await seedDrink(5);
    const id = await prepared("cash");
    expect(await add(id, [unit(drink.productId)])).toMatchObject({ ok: true });
    expect(await add(id, [unit(drink.productId)])).toMatchObject({ ok: true });
    expect(await itemQty(drink.itemId)).toBe(3000);
  });

  it("falta de stock al confirmar → OUT_OF_STOCK y sigue pendiente", async () => {
    const drink = await seedDrink(1);
    const id = await prepared("transfer");
    const r = await add(id, [unit(drink.productId), unit(drink.productId)]);
    if (!r.ok) throw new Error(r.message);
    const before = await order(id);
    const c = await confirm(r.data.addonId);
    expect(c).toMatchObject({ ok: false, code: "OUT_OF_STOCK", productIds: [drink.productId] });
    expect((await addon(r.data.addonId)).status).toBe("pendiente_pago");
    expect(await order(id)).toEqual(before);
    expect(await itemQty(drink.itemId)).toBe(1000);
    expect((await items(id)).filter((i) => i.addonId !== null)).toHaveLength(0);
  });

  it("falta de stock al agregar (confirmación en el acto) no escribe nada", async () => {
    const drink = await seedDrink(1);
    const id = await prepared("cash");
    const r = await add(id, [unit(drink.productId), unit(drink.productId)]);
    expect(r).toMatchObject({ ok: false, code: "OUT_OF_STOCK" });
    expect(await db().select().from(s.orderAddons)).toHaveLength(0);
  });

  it("pedido que ya no está en_preparacion → INVALID_STATE", async () => {
    const id = await prepared("cash");
    const t = await prepared("transfer");
    const p = await add(t, [unit(fx.melt)]);
    if (!p.ok) throw new Error(p.message);
    await db().update(s.orders).set({ status: "listo_despacho" }).where(eq(s.orders.id, id));
    await db().update(s.orders).set({ status: "listo_despacho" }).where(eq(s.orders.id, t));
    expect(await add(id, [unit(fx.melt)])).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await confirm(p.data.addonId)).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await add(424242, [unit(fx.melt)])).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("markReady cancela los pendientes y deja los confirmados", async () => {
    const id = await prepared("transfer");
    const a = await add(id, [unit(fx.melt)]);
    const b = await add(id, [unit(fx.melt)]);
    if (!a.ok || !b.ok) throw new Error("setup");
    expect(await confirm(a.data.addonId)).toMatchObject({ ok: true });
    const r = await markReady(db(), { orderId: id, userId: fx.userId, sector: null });
    expect(r).toMatchObject({ ok: true, data: { cancelledAddons: 1 } });
    expect((await addon(a.data.addonId)).status).toBe("confirmado");
    expect(await addon(b.data.addonId)).toMatchObject({ status: "cancelado", cancelledBy: fx.userId });
  });

  it("cancelOrder cancela pendientes y devuelve todo el stock neto", async () => {
    const drink = await seedDrink(5);
    const id = await prepared("transfer", [unit(drink.productId)]);
    expect(await itemQty(drink.itemId)).toBe(4000);
    const a = await add(id, [unit(drink.productId)]);
    const b = await add(id, [unit(drink.productId)]);
    if (!a.ok || !b.ok) throw new Error("setup");
    expect(await confirm(a.data.addonId)).toMatchObject({ ok: true });
    expect(await itemQty(drink.itemId)).toBe(3000);
    const r = await cancelOrder(db(), { orderId: id, userId: fx.userId, reason: "se arrepintió", sector: null });
    expect(r).toMatchObject({ ok: true });
    expect(await itemQty(drink.itemId)).toBe(5000);
    expect((await addon(b.data.addonId)).status).toBe("cancelado");
    expect((await addon(a.data.addonId)).status).toBe("confirmado");
  });

  it("cancelAddon solo desde pendiente_pago", async () => {
    const id = await prepared("transfer");
    const a = await add(id, [unit(fx.melt)]);
    if (!a.ok) throw new Error(a.message);
    const before = await order(id);
    expect(await cancelAddon(db(), { addonId: a.data.addonId, userId: fx.userId, sector: null, reason: "no pagó" })).toMatchObject({ ok: true, data: { addonId: a.data.addonId } });
    expect(await addon(a.data.addonId)).toMatchObject({ status: "cancelado", cancelledBy: fx.userId, cancelReason: "no pagó" });
    expect(await order(id)).toEqual(before);
    expect(await cancelAddon(db(), { addonId: a.data.addonId, userId: fx.userId, sector: null, reason: null })).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await confirm(a.data.addonId)).toMatchObject({ ok: false, code: "INVALID_STATE" });
    const c = await add(id, [unit(fx.melt)], { });
    if (!c.ok) throw new Error(c.message);
    expect(await confirm(c.data.addonId)).toMatchObject({ ok: true });
    expect(await cancelAddon(db(), { addonId: c.data.addonId, userId: fx.userId, sector: null, reason: null })).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("valida unidades y clave: VALIDATION sin escribir nada", async () => {
    const drink = await seedDrink(5);
    const id = await prepared("cash");
    const before = await order(id);
    const bad = [
      add(id, []),
      add(id, Array.from({ length: 101 }, () => unit(fx.melt))),
      add(id, [unit(fx.melt, [], "x".repeat(2000))]),
      add(id, [{ productId: "1" as unknown as number, modifierIds: [], note: "" }]),
      add(id, [unit(drink.productId)], { idempotencyKey: "" }),
      add(id, [unit(drink.productId)], { idempotencyKey: "k".repeat(500) }),
    ];
    for (const r of await Promise.all(bad)) expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await order(id)).toEqual(before);
    expect(await db().select().from(s.orderAddons)).toHaveLength(0);
    expect(await itemQty(drink.itemId)).toBe(5000);
  });

  it("pedido sin estación no deja movimientos de stock", async () => {
    const drink = await seedDrink(5);
    const id = await prepared("cash");
    await db().update(s.orders).set({ stationId: null }).where(eq(s.orders.id, id));
    expect(await add(id, [unit(drink.productId)])).toMatchObject({ ok: false, code: "UNEXPECTED" });
    expect(await itemQty(drink.itemId)).toBe(5000);
    expect(await db().select().from(s.orderAddons)).toHaveLength(0);
  });

  it("respeta el sector", async () => {
    const id = await prepared("cash"); // delivery
    expect(await add(id, [unit(fx.melt)], { sector: "mostrador" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    const t = await prepared("transfer");
    const p = await add(t, [unit(fx.melt)], { sector: "delivery" });
    if (!p.ok) throw new Error(p.message);
    expect(await confirm(p.data.addonId, { sector: "mostrador" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await cancelAddon(db(), { addonId: p.data.addonId, userId: fx.userId, sector: "mostrador", reason: null })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await confirm(p.data.addonId, { sector: "delivery" })).toMatchObject({ ok: true });
  });
});
