import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { createOrder } from "./create-order";
import { getOrderForTracking, getTrackingStatus } from "./tracking";

const db = () => testDb();
const TOKEN = "0123456789abcdef0123456789abcdef";
const KEY = "3f2b8c1e-5d4a-4b7c-9e1f-0a2b3c4d5e6f";
const WHATSAPP_DIGITS = "5491155551234";

type Fx = { ranchita: number; dips: number; sinCheddar: number; swap: number };

async function seedMenu(): Promise<Fx> {
  const d = db();
  const [cat] = await d.insert(s.categories).values({ name: "Burgers", slug: "burgers" }).returning();
  const [ranchita] = await d
    .insert(s.products)
    .values({ categoryId: cat.id, name: "Ranchita simple", price: 8500_00 })
    .returning();
  const [g1, g2, g3] = await d
    .insert(s.modifierGroups)
    .values([{ name: "Quitar" }, { name: "Agregados" }, { name: "Cambiar" }])
    .returning();
  const mods = await d
    .insert(s.modifiers)
    .values([
      { groupId: g1.id, name: "Sin cheddar", kind: "remove", priceDelta: 0, kitchenLabel: "SIN CHEDDAR" },
      { groupId: g2.id, name: "Dips", kind: "add", priceDelta: 1200_00, kitchenLabel: "+ DIPS" },
      { groupId: g3.id, name: "Pan negro", kind: "swap", priceDelta: 300_00, kitchenLabel: "PAN NEGRO" },
    ])
    .returning();
  await d.insert(s.productModifierGroups).values([g1, g2, g3].map((g) => ({ productId: ranchita.id, groupId: g.id })));
  return { ranchita: ranchita.id, sinCheddar: mods[0].id, dips: mods[1].id, swap: mods[2].id };
}

const input = (fx: Fx, over: Record<string, unknown> = {}) => ({
  idempotencyKey: KEY,
  units: [
    { productId: fx.ranchita, modifierIds: [fx.dips, fx.sinCheddar], note: "bien cocida" },
    { productId: fx.ranchita, modifierIds: [fx.swap], note: "" },
  ],
  customer: { name: "Juana Pérez Gómez", whatsapp: "+54 9 11 5555-1234" },
  fulfillment: "delivery",
  delivery: { address: "Av. Siempreviva 742", crossStreets: "Entre Mitre y Sarmiento", notes: "timbre roto, tocar fuerte" },
  paymentMethod: "transfer",
  bh_ref: "",
  ...over,
});

async function place(fx: Fx, over: Record<string, unknown> = {}) {
  const r = await createOrder(db(), input(fx, over), { newToken: () => TOKEN });
  if (!r.ok) throw new Error(`order not created: ${r.code}`);
  return r.data;
}

/** A db whose every use throws: proves a code path never queries. */
const untouchableDb = new Proxy(
  {},
  {
    get: () => {
      throw new Error("DB touched");
    },
  },
) as unknown as Db;

let fx: Fx;
beforeEach(async () => {
  await resetDb();
  fx = await seedMenu();
});
afterAll(closeDb);

describe("getOrderForTracking", () => {
  it("groups the units and takes every money value from the snapshots", async () => {
    await db().insert(s.settings).values({ key: "delivery_fee", value: 1500_00 }).onConflictDoUpdate({ target: s.settings.key, set: { value: 1500_00 } });
    await place(fx);
    const dto = await getOrderForTracking(db(), TOKEN);
    expect(dto).not.toBeNull();
    expect(dto!.groups).toHaveLength(2);
    expect(dto!.groups[0]).toMatchObject({
      name: "Ranchita simple",
      quantity: 1,
      note: "bien cocida",
      unitTotal: 8500_00 + 1200_00,
      lineTotal: 8500_00 + 1200_00,
    });
    expect(dto!.groups[0].modifiers.map((m) => [m.name, m.priceDelta]).sort()).toEqual([
      ["Dips", 1200_00],
      ["Sin cheddar", 0],
    ]);
    expect(dto!.groups[1]).toEqual({
      name: "Ranchita simple",
      quantity: 1,
      modifiers: [{ name: "Pan negro", priceDelta: 300_00 }],
      note: null,
      unitTotal: 8800_00,
      lineTotal: 8800_00,
    });
    expect(dto).toMatchObject({
      number: 1,
      status: "pendiente_aprobacion",
      fulfillment: "delivery",
      channel: "web",
      paymentMethod: "transfer",
      paymentStatus: "pending",
      firstName: "Juana",
      addressLine: "Av. Siempreviva 742",
      subtotal: 8500_00 * 2 + 1200_00 + 300_00,
      deliveryFee: 1500_00,
      total: 8500_00 * 2 + 1200_00 + 300_00 + 1500_00,
    });
    expect(new Date(dto!.createdAt).toISOString()).toBe(dto!.createdAt);
  });

  it("identical units are one group of 2", async () => {
    await place(fx, {
      units: [
        { productId: fx.ranchita, modifierIds: [fx.dips], note: "" },
        { productId: fx.ranchita, modifierIds: [fx.dips], note: "" },
      ],
    });
    const dto = await getOrderForTracking(db(), TOKEN);
    expect(dto!.groups).toHaveLength(1);
    expect(dto!.groups[0]).toMatchObject({ quantity: 2, unitTotal: 9700_00, lineTotal: 19400_00 });
  });

  it("the DTO is an allow-list: no private value or key in its JSON", async () => {
    await place(fx);
    const dto = await getOrderForTracking(db(), TOKEN);
    const json = JSON.stringify(dto);
    for (const secret of [WHATSAPP_DIGITS, "Pérez", "Gómez", "Entre Mitre", "Sarmiento", "timbre roto", KEY, TOKEN]) {
      expect(json).not.toContain(secret);
    }
    expect(Object.keys(dto!).sort()).toEqual(
      [
        "addressLine",
        "channel",
        "createdAt",
        "deliveryFee",
        "firstName",
        "fulfillment",
        "groups",
        "number",
        "paymentMethod",
        "paymentStatus",
        "status",
        "subtotal",
        "total",
      ].sort(),
    );
    expect(Object.keys(dto!.groups[0]).sort()).toEqual(["lineTotal", "modifiers", "name", "note", "quantity", "unitTotal"]);
  });

  it("snapshots survive later price and name changes of the catalog", async () => {
    await place(fx);
    await db().update(s.products).set({ price: 1, name: "Renombrada" }).where(eq(s.products.id, fx.ranchita));
    await db().update(s.modifiers).set({ priceDelta: 999_99, name: "Otro" }).where(eq(s.modifiers.id, fx.dips));
    const dto = await getOrderForTracking(db(), TOKEN);
    expect(dto!.groups[0].name).toBe("Ranchita simple");
    expect(dto!.groups[0].unitTotal).toBe(9700_00);
    expect(dto!.groups[0].modifiers.map((m) => m.name)).toContain("Dips");
    expect(dto!.subtotal).toBe(8500_00 * 2 + 1200_00 + 300_00);
  });

  it("a deleted product keeps its snapshot lines", async () => {
    await place(fx);
    await db().delete(s.productModifierGroups);
    await db().delete(s.products).where(eq(s.products.id, fx.ranchita));
    const dto = await getOrderForTracking(db(), TOKEN);
    expect(dto!.groups.map((g) => g.name)).toEqual(["Ranchita simple", "Ranchita simple"]);
  });

  it("malformed tokens return null WITHOUT touching the database", async () => {
    const bad = [
      "",
      "abc",
      TOKEN.toUpperCase(),
      `${TOKEN}0`,
      TOKEN.slice(1),
      `${TOKEN.slice(0, 31)}g`,
      ` ${TOKEN.slice(1)}`,
      `${TOKEN}\n`,
      "../../etc/passwd",
      "x'; drop table orders;--",
    ];
    for (const t of bad) expect(await getOrderForTracking(untouchableDb, t)).toBeNull();
    expect(await getTrackingStatus(untouchableDb, "nope")).toBeNull();
  });

  it("an unknown token of valid shape returns null", async () => {
    await place(fx);
    expect(await getOrderForTracking(db(), "f".repeat(32))).toBeNull();
  });

  it("reflects a status change made in the database", async () => {
    await place(fx);
    await db().update(s.orders).set({ status: "en_camino", paymentStatus: "paid" }).where(eq(s.orders.publicToken, TOKEN));
    const dto = await getOrderForTracking(db(), TOKEN);
    expect(dto).toMatchObject({ status: "en_camino", paymentStatus: "paid" });
  });

  it("takeaway has no address", async () => {
    await place(fx, { fulfillment: "takeaway", delivery: undefined, paymentMethod: "cash" });
    const dto = await getOrderForTracking(db(), TOKEN);
    expect(dto!.fulfillment).toBe("takeaway");
    expect(dto!.addressLine).toBeNull();
    expect(dto!.deliveryFee).toBe(0);
  });

  it("firstName is only the first word, even for one-word names", async () => {
    await place(fx, { customer: { name: "Cher", whatsapp: "5491155551234" } });
    expect((await getOrderForTracking(db(), TOKEN))!.firstName).toBe("Cher");
  });
});

describe("getTrackingStatus", () => {
  it("returns exactly status, paymentStatus and updatedAt", async () => {
    await place(fx);
    const r = await getTrackingStatus(db(), TOKEN);
    expect(Object.keys(r!).sort()).toEqual(["paymentStatus", "status", "updatedAt"]);
    expect(r).toMatchObject({ status: "pendiente_aprobacion", paymentStatus: "pending" });
    expect(new Date(r!.updatedAt).toISOString()).toBe(r!.updatedAt);
  });

  it("updatedAt follows the latest order event", async () => {
    await place(fx);
    const [o] = await db().select().from(s.orders);
    const at = new Date("2030-01-02T03:04:05.000Z");
    await db().insert(s.orderEvents).values({ orderId: o.id, fromStatus: "pendiente_aprobacion", toStatus: "en_preparacion", at });
    expect((await getTrackingStatus(db(), TOKEN))!.updatedAt).toBe(at.toISOString());
  });

  it("unknown valid-shape token is null", async () => {
    expect(await getTrackingStatus(db(), "e".repeat(32))).toBeNull();
  });
});
