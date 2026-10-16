import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { transitionOrder, currentStateMessage } from "./transition";

const db = () => testDb();
let userId: number;
let stationId: number;

async function seedOrder(over: Partial<typeof s.orders.$inferInsert> = {}) {
  const [o] = await db()
    .insert(s.orders)
    .values({
      businessDate: "2026-10-14",
      number: Math.floor(Math.random() * 1e6),
      publicToken: Math.random().toString(36).slice(2) + Date.now(),
      channel: "web",
      fulfillment: "delivery",
      status: "pendiente_aprobacion",
      paymentMethod: "cash",
      customerName: "Ana",
      subtotal: 100,
      total: 100,
      ...over,
    })
    .returning();
  return o;
}
const run = (input: Parameters<typeof transitionOrder>[1]) => db().transaction((tx) => transitionOrder(tx, input));
const events = (orderId: number) => db().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, orderId));
const reload = async (id: number) => (await db().select().from(s.orders).where(eq(s.orders.id, id)))[0];

beforeEach(async () => {
  await resetDb();
  const [u] = await db().insert(s.users).values({ name: "C", username: "c", passwordHash: "x", role: "cajera" }).returning();
  const [st] = await db().insert(s.stations).values({ name: "M1", kind: "mostrador" }).returning();
  userId = u.id;
  stationId = st.id;
});
afterAll(closeDb);

describe("transitionOrder", () => {
  it("moves the order, applies the patch in the same update and writes the event", async () => {
    const o = await seedOrder();
    const at = new Date("2026-10-14T12:00:00Z");
    const r = await run({ sector: null,
      orderId: o.id,
      to: "en_preparacion",
      userId,
      note: "ok",
      patch: { paymentStatus: "paid", approvedBy: userId, approvedAt: at, stationId },
    });
    expect(r).toEqual({
      ok: true,
      data: { order: { id: o.id, status: "en_preparacion", fulfillment: "delivery", paymentMethod: "cash", paymentStatus: "paid" } },
    });
    const row = await reload(o.id);
    expect(row).toMatchObject({ status: "en_preparacion", paymentStatus: "paid", approvedBy: userId, stationId });
    expect(row.approvedAt).toEqual(at);
    expect(await events(o.id)).toMatchObject([
      { fromStatus: "pendiente_aprobacion", toStatus: "en_preparacion", userId, note: "ok" },
    ]);
  });

  it("unknown or invalid id -> NOT_FOUND / VALIDATION, nothing written", async () => {
    expect(await run({ sector: null, orderId: 999, to: "cancelado", userId })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await run({ sector: null, orderId: -1, to: "cancelado", userId })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await db().select().from(s.orderEvents)).toHaveLength(0);
  });

  it("uses the DOMAIN table: illegal jumps fail naming the current state and change nothing", async () => {
    const o = await seedOrder({ status: "en_preparacion" });
    const r = await run({ sector: null, orderId: o.id, to: "entregado", userId, patch: { paymentStatus: "paid" } });
    expect(r).toEqual({ ok: false, code: "INVALID_TRANSITION", message: "Este pedido ya está en preparación" });
    expect((await reload(o.id)).paymentStatus).toBe("pending");
    expect(await events(o.id)).toHaveLength(0);
  });

  it("respects fulfillment-specific edges", async () => {
    const o = await seedOrder({ status: "listo_despacho", fulfillment: "takeaway" });
    expect(await run({ sector: null, orderId: o.id, to: "en_camino", userId })).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(await run({ sector: null, orderId: o.id, to: "para_retirar", userId })).toMatchObject({ ok: true });
  });

  it("the optional from allow-list narrows the domain table", async () => {
    const o = await seedOrder({ status: "en_preparacion" });
    const r = await run({ sector: null, orderId: o.id, to: "listo_despacho", userId, from: ["pendiente_aprobacion"] });
    expect(r).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect((await reload(o.id)).status).toBe("en_preparacion");
  });

  it("serializes concurrent transitions: exactly one wins", async () => {
    const o = await seedOrder();
    const rs = await Promise.all(
      Array.from({ length: 5 }, () => run({ sector: null, orderId: o.id, to: "en_preparacion", userId, from: ["pendiente_aprobacion"] })),
    );
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok && r.code === "INVALID_TRANSITION")).toHaveLength(4);
    expect(await events(o.id)).toHaveLength(1);
  });
});

describe("currentStateMessage", () => {
  it.each([
    ["pendiente_aprobacion", "Este pedido está pendiente de aprobación"],
    ["en_preparacion", "Este pedido ya está en preparación"],
    ["listo_despacho", "Este pedido ya está listo para despacho"],
    ["en_camino", "Este pedido ya está en camino"],
    ["para_retirar", "Este pedido ya está listo para retirar"],
    ["entregado", "Este pedido ya fue entregado"],
    ["cancelado", "Este pedido fue cancelado"],
  ] as const)("%s", (st, msg) => expect(currentStateMessage(st)).toBe(msg));
});
