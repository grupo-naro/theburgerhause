import { randomUUID } from "node:crypto";
import * as s from "@/db/schema";
import { testDb } from "@/db/test-utils";
import { createOrder } from "@/lib/orders/create-order";

/** Menu + staff fixtures shared by the order int tests. Prices in centavos. */
export async function seedMenuAndStaff() {
  const d = testDb();
  const [cat] = await d.insert(s.categories).values({ name: "Burgers", slug: "burgers" }).returning();
  const [ranchita, melt] = await d
    .insert(s.products)
    .values([
      { categoryId: cat.id, name: "Ranchita simple", price: 8500_00 },
      { categoryId: cat.id, name: "Melt simple", price: 8800_00 },
    ])
    .returning();
  const [gA, gB] = await d.insert(s.modifierGroups).values([{ name: "Quitar" }, { name: "Agregados" }]).returning();
  const [sinCheddar, dips, descuento] = await d
    .insert(s.modifiers)
    .values([
      { groupId: gA.id, name: "Sin cheddar", kind: "remove", priceDelta: 0, kitchenLabel: "SIN CHEDDAR" },
      { groupId: gB.id, name: "Dips", kind: "add", priceDelta: 1200_00, kitchenLabel: "+ DIPS" },
      { groupId: gB.id, name: "Combo desc.", kind: "swap", priceDelta: -300_00, kitchenLabel: "COMBO" },
    ])
    .returning();
  await d.insert(s.productModifierGroups).values([
    { productId: ranchita.id, groupId: gA.id },
    { productId: ranchita.id, groupId: gB.id },
    { productId: melt.id, groupId: gA.id },
  ]);
  const users = await d
    .insert(s.users)
    .values([
      { name: "Cora", username: "cora", passwordHash: "x", role: "cajera" },
      { name: "Enca", username: "enca", passwordHash: "x", role: "encargada_delivery" },
    ])
    .returning({ id: s.users.id });
  const stations = await d
    .insert(s.stations)
    .values([
      { name: "Mostrador 1", kind: "mostrador" },
      { name: "Delivery", kind: "delivery" },
    ])
    .returning({ id: s.stations.id });
  return {
    ranchita: ranchita.id,
    melt: melt.id,
    sinCheddar: sinCheddar.id,
    dips: dips.id,
    descuento: descuento.id,
    userId: users[0].id,
    otherUserId: users[1].id,
    stationId: stations[0].id,
    otherStationId: stations[1].id,
  };
}
export type Fx = Awaited<ReturnType<typeof seedMenuAndStaff>>;

/** A real web order through `createOrder` (2 units with modifiers unless `units` is given). */
export async function placeWebOrder(
  fx: Fx,
  over: { fulfillment?: "delivery" | "takeaway"; paymentMethod?: "cash" | "transfer"; units?: unknown[] } = {},
): Promise<{ id: number; number: number }> {
  const fulfillment = over.fulfillment ?? "delivery";
  const r = await createOrder(testDb(), {
    idempotencyKey: randomUUID(),
    units: over.units ?? [
      { productId: fx.ranchita, modifierIds: [fx.dips, fx.sinCheddar], note: "bien cocida" },
      { productId: fx.ranchita, modifierIds: [fx.descuento], note: "" },
      { productId: fx.melt, modifierIds: [], note: "" },
    ],
    customer: { name: "Juana Pérez", whatsapp: "+54 9 11 5555-1234" },
    fulfillment,
    ...(fulfillment === "delivery"
      ? { delivery: { address: "Av. Siempreviva 742", crossStreets: "Mitre y Sarmiento", notes: "timbre roto" } }
      : {}),
    paymentMethod: over.paymentMethod ?? "cash",
    bh_ref: "",
  });
  if (!r.ok) throw new Error(`seed order failed: ${r.code}`);
  const rows = await testDb().select({ id: s.orders.id, number: s.orders.number }).from(s.orders);
  return rows.find((x) => x.number === r.data.number)!;
}
