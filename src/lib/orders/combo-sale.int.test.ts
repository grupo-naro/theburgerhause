import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, isNotNull } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { setComboItems } from "@/lib/menu/combos";
import { setInitialStock } from "@/lib/stock/movements";
import { itemQty } from "@/lib/stock/test-fixtures";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { addOrderAddon, confirmAddon } from "./addons";
import { approveOrder } from "./approve-order";
import { createOrder } from "./create-order";

const db = () => testDb();
let fx: Fx;
let combo: number;
let coke: number;
let cokeItem: number;

beforeEach(async () => {
  await resetDb();
  fx = await seedMenuAndStaff();
  const [cat] = await db().select().from(s.categories).limit(1);
  const [item] = await db().insert(s.stockItems).values({ name: "Coca 500", kind: "bebida", unit: "u", minQty: 0 }).returning({ id: s.stockItems.id });
  cokeItem = item.id;
  const [cokeRow, comboRow] = await db()
    .insert(s.products)
    .values([
      { categoryId: cat.id, name: "Coca 500", price: 250_000, stockItemId: item.id, cost: 100_000 },
      { categoryId: cat.id, name: "Combo para 4", price: 3_500_000 },
    ])
    .returning({ id: s.products.id });
  coke = cokeRow.id;
  combo = comboRow.id;
  await db().update(s.products).set({ patties: 2, cost: 280_000 }).where(eq(s.products.id, fx.ranchita));
  const r = await setInitialStock(db(), { itemId: cokeItem, userId: fx.userId, milli: 10_000 });
  if (!r.ok) throw new Error(r.message);
  expect(await setComboItems(db(), combo, [{ productId: fx.ranchita, quantity: 4 }, { productId: coke, quantity: 2 }])).toEqual({ ok: true, data: null });
});
afterAll(closeDb);

const itemsOf = (orderId: number) => db().select().from(s.orderItems).where(eq(s.orderItems.orderId, orderId));

describe("selling a combo", () => {
  it("snapshots its contents, patties and cost on the order item", async () => {
    const o = await placeWebOrder(fx, { units: [{ productId: combo, modifierIds: [], note: "" }] });
    const [item] = await itemsOf(o.id);
    expect(item.nameSnapshot).toBe("Combo para 4");
    expect(item.unitPriceSnapshot).toBe(3_500_000);
    expect(item.comboSnapshot).toEqual([
      { name: "Ranchita simple", quantity: 4 },
      { name: "Coca 500", quantity: 2 },
    ]);
    expect(item.pattiesSnapshot).toBe(8);
    expect(item.unitCostSnapshot).toBe(4 * 280_000 + 2 * 100_000);
  });

  it("the combo's own cost and patties win over the components'", async () => {
    await db().update(s.products).set({ cost: 1_000_000, patties: 3 }).where(eq(s.products.id, combo));
    const o = await placeWebOrder(fx, { units: [{ productId: combo, modifierIds: [], note: "" }] });
    const [item] = await itemsOf(o.id);
    expect(item.unitCostSnapshot).toBe(1_000_000);
    expect(item.pattiesSnapshot).toBe(3);
  });

  it("no cost when a component has none (and the combo has none of its own)", async () => {
    await db().update(s.products).set({ cost: null }).where(eq(s.products.id, coke));
    const o = await placeWebOrder(fx, { units: [{ productId: combo, modifierIds: [], note: "" }] });
    expect((await itemsOf(o.id))[0].unitCostSnapshot).toBeNull();
  });

  it("takes the drinks inside the combo off the stock", async () => {
    await placeWebOrder(fx, { units: [{ productId: combo, modifierIds: [], note: "" }, { productId: combo, modifierIds: [], note: "" }] });
    expect(await itemQty(cokeItem)).toBe(10_000 - 4 * 1000);
  });

  it("refuses the order when a drink inside the combo is short, naming the drink", async () => {
    const r = await createOrder(db(), {
      idempotencyKey: crypto.randomUUID(),
      units: Array.from({ length: 6 }, () => ({ productId: combo, modifierIds: [], note: "" })),
      customer: { name: "Ana", whatsapp: "+54 9 11 5555-1234" },
      fulfillment: "takeaway",
      paymentMethod: "cash",
      bh_ref: "",
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("OUT_OF_STOCK");
    expect(await itemQty(cokeItem)).toBe(10_000);
  });

  it("a combo whose component was paused cannot be sold", async () => {
    await db().update(s.products).set({ active: false }).where(eq(s.products.id, fx.ranchita));
    await expect(placeWebOrder(fx, { units: [{ productId: combo, modifierIds: [], note: "" }] })).rejects.toThrow(/PRODUCT_UNAVAILABLE|seed order failed/);
  });

  it("a plain product has no combo snapshot", async () => {
    const o = await placeWebOrder(fx, { units: [{ productId: fx.melt, modifierIds: [], note: "" }] });
    expect((await itemsOf(o.id))[0].comboSnapshot).toBeNull();
  });
});

describe("a combo added to an order (add-on)", () => {
  it("keeps its contents when the add-on is confirmed later", async () => {
    const o = await placeWebOrder(fx, { paymentMethod: "transfer", units: [{ productId: fx.melt, modifierIds: [], note: "" }] });
    const ok = await approveOrder(db(), { orderId: o.id, userId: fx.userId, stationId: fx.otherStationId, paymentVerified: true, sector: null });
    if (!ok.ok) throw new Error(ok.message);
    const a = await addOrderAddon(db(), { orderId: o.id, userId: fx.userId, sector: null, units: [{ productId: combo, modifierIds: [], note: "" }], idempotencyKey: crypto.randomUUID() });
    if (!a.ok) throw new Error(a.message);
    expect(await confirmAddon(db(), { addonId: a.data.addonId, userId: fx.userId, sector: null, paymentVerified: true })).toMatchObject({ ok: true });
    const [added] = await db().select().from(s.orderItems).where(isNotNull(s.orderItems.addonId));
    expect(added.comboSnapshot).toEqual([
      { name: "Ranchita simple", quantity: 4 },
      { name: "Coca 500", quantity: 2 },
    ]);
    expect(added.pattiesSnapshot).toBe(8);
  });
});
