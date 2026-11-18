import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { loadMenu } from "@/lib/menu/public";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { addOrderAddon, confirmAddon } from "./addons";
import { approveOrder } from "./approve-order";

const db = () => testDb();
let fx: Fx;

const itemsOf = (orderId: number) => db().select().from(s.orderItems).where(eq(s.orderItems.orderId, orderId)).orderBy(s.orderItems.id);
const modsOf = (itemIds: number[]) => db().select().from(s.orderItemModifiers).where(inArray(s.orderItemModifiers.orderItemId, itemIds));

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
  await db().update(s.products).set({ cost: 280000 }).where(eq(s.products.id, fx.ranchita));
  await db().update(s.modifiers).set({ cost: 40000 }).where(eq(s.modifiers.id, fx.dips));
});
afterAll(closeDb);

describe("cost snapshot on every sale", () => {
  it("sale snapshots product and extra cost", async () => {
    const o = await placeWebOrder(fx, { units: [{ productId: fx.ranchita, modifierIds: [fx.dips], note: "" }] });
    const [item] = await itemsOf(o.id);
    expect(item.unitCostSnapshot).toBe(280000);
    const [mod] = await modsOf([item.id]);
    expect(mod.costSnapshot).toBe(40000);
  });

  it("later cost change does not touch past sales", async () => {
    const o = await placeWebOrder(fx, { units: [{ productId: fx.ranchita, modifierIds: [], note: "" }] });
    await db().update(s.products).set({ cost: 999900 }).where(eq(s.products.id, fx.ranchita));
    expect((await itemsOf(o.id))[0].unitCostSnapshot).toBe(280000);
  });

  it("product without cost snapshots null", async () => {
    const o = await placeWebOrder(fx, { units: [{ productId: fx.melt, modifierIds: [], note: "" }] });
    expect((await itemsOf(o.id))[0].unitCostSnapshot).toBeNull();
  });

  it("legacy add-on json without cost", async () => {
    const o = await placeWebOrder(fx, { paymentMethod: "transfer", units: [{ productId: fx.melt, modifierIds: [], note: "" }] });
    const ok = await approveOrder(db(), { orderId: o.id, userId: fx.userId, stationId: fx.otherStationId, paymentVerified: true, sector: null });
    if (!ok.ok) throw new Error(ok.message);
    const a = await addOrderAddon(db(), { orderId: o.id, userId: fx.userId, sector: null, units: [{ productId: fx.ranchita, modifierIds: [fx.dips], note: "" }], idempotencyKey: randomUUID() });
    if (!a.ok) throw new Error(a.message);
    // Simulate an add-on stored before costs existed: strip every cost key from its JSON.
    const [row] = await db().select({ units: s.orderAddons.units }).from(s.orderAddons).where(eq(s.orderAddons.id, a.data.addonId));
    const legacy = JSON.parse(JSON.stringify(row.units), (k, v) => (k === "cost" ? undefined : v));
    await db().update(s.orderAddons).set({ units: legacy }).where(eq(s.orderAddons.id, a.data.addonId));

    const c = await confirmAddon(db(), { addonId: a.data.addonId, userId: fx.userId, sector: null, paymentVerified: true });
    expect(c).toMatchObject({ ok: true });
    const added = await db().select().from(s.orderItems).where(isNotNull(s.orderItems.addonId));
    expect(added).toHaveLength(1);
    expect(added[0].unitCostSnapshot).toBeNull();
  });

  it("an add-on keeps the cost it had when it was created", async () => {
    const o = await placeWebOrder(fx, { paymentMethod: "transfer", units: [{ productId: fx.melt, modifierIds: [], note: "" }] });
    const ok = await approveOrder(db(), { orderId: o.id, userId: fx.userId, stationId: fx.otherStationId, paymentVerified: true, sector: null });
    if (!ok.ok) throw new Error(ok.message);
    const a = await addOrderAddon(db(), { orderId: o.id, userId: fx.userId, sector: null, units: [{ productId: fx.ranchita, modifierIds: [], note: "" }], idempotencyKey: randomUUID() });
    if (!a.ok) throw new Error(a.message);
    await db().update(s.products).set({ cost: 123400 }).where(eq(s.products.id, fx.ranchita));
    const c = await confirmAddon(db(), { addonId: a.data.addonId, userId: fx.userId, sector: null, paymentVerified: true });
    expect(c.ok).toBe(true);
    const [added] = await db().select().from(s.orderItems).where(isNotNull(s.orderItems.addonId));
    expect(added.unitCostSnapshot).toBe(280000);
  });

  it("public menu has no cost", async () => {
    const json = JSON.stringify(await loadMenu(db()));
    expect(json).not.toContain('"cost"');
    expect(json).not.toContain("280000");
    expect(json).not.toContain("40000");
  });
});

describe("patties snapshot on every sale", () => {
  beforeEach(async () => {
    await db().update(s.products).set({ patties: 2 }).where(eq(s.products.id, fx.ranchita));
  });

  it("sale snapshots patties", async () => {
    const o = await placeWebOrder(fx, { units: [{ productId: fx.ranchita, modifierIds: [], note: "" }] });
    expect((await itemsOf(o.id))[0].pattiesSnapshot).toBe(2);
  });

  it("later patties change does not touch past sales", async () => {
    const o = await placeWebOrder(fx, { units: [{ productId: fx.ranchita, modifierIds: [], note: "" }] });
    await db().update(s.products).set({ patties: 3 }).where(eq(s.products.id, fx.ranchita));
    expect((await itemsOf(o.id))[0].pattiesSnapshot).toBe(2);
  });

  it("legacy add-on json without patties confirms with 0", async () => {
    const o = await placeWebOrder(fx, { paymentMethod: "transfer", units: [{ productId: fx.melt, modifierIds: [], note: "" }] });
    const ok = await approveOrder(db(), { orderId: o.id, userId: fx.userId, stationId: fx.otherStationId, paymentVerified: true, sector: null });
    if (!ok.ok) throw new Error(ok.message);
    const a = await addOrderAddon(db(), { orderId: o.id, userId: fx.userId, sector: null, units: [{ productId: fx.ranchita, modifierIds: [], note: "" }], idempotencyKey: randomUUID() });
    if (!a.ok) throw new Error(a.message);
    const [row] = await db().select({ units: s.orderAddons.units }).from(s.orderAddons).where(eq(s.orderAddons.id, a.data.addonId));
    const legacy = JSON.parse(JSON.stringify(row.units), (k, v) => (k === "patties" ? undefined : v));
    await db().update(s.orderAddons).set({ units: legacy }).where(eq(s.orderAddons.id, a.data.addonId));
    const c = await confirmAddon(db(), { addonId: a.data.addonId, userId: fx.userId, sector: null, paymentVerified: true });
    expect(c).toMatchObject({ ok: true });
    const [added] = await db().select().from(s.orderItems).where(isNotNull(s.orderItems.addonId));
    expect(added.pattiesSnapshot).toBe(0);
  });

  it("an add-on keeps the patties it had when it was created", async () => {
    const o = await placeWebOrder(fx, { paymentMethod: "transfer", units: [{ productId: fx.melt, modifierIds: [], note: "" }] });
    const ok = await approveOrder(db(), { orderId: o.id, userId: fx.userId, stationId: fx.otherStationId, paymentVerified: true, sector: null });
    if (!ok.ok) throw new Error(ok.message);
    const a = await addOrderAddon(db(), { orderId: o.id, userId: fx.userId, sector: null, units: [{ productId: fx.ranchita, modifierIds: [], note: "" }], idempotencyKey: randomUUID() });
    if (!a.ok) throw new Error(a.message);
    await db().update(s.products).set({ patties: 1 }).where(eq(s.products.id, fx.ranchita));
    await confirmAddon(db(), { addonId: a.data.addonId, userId: fx.userId, sector: null, paymentVerified: true });
    const [added] = await db().select().from(s.orderItems).where(isNotNull(s.orderItems.addonId));
    expect(added.pattiesSnapshot).toBe(2);
  });

  it("public menu has no patties", async () => {
    expect(JSON.stringify(await loadMenu(db()))).not.toContain('"patties"');
  });
});
