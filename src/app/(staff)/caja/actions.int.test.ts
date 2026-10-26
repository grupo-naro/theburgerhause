import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/orders/approve-order", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/orders/approve-order")>();
  return { ...m, approveOrder: vi.fn(m.approveOrder) };
});
vi.mock("@/lib/orders/reject-order", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/orders/reject-order")>();
  return { ...m, rejectOrder: vi.fn(m.rejectOrder) };
});
vi.mock("@/lib/menu/cache", () => ({ invalidateMenu: vi.fn(), MENU_CACHE_TAG: "menu" }));
vi.mock("@/lib/orders/reprint", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/orders/reprint")>();
  return { ...m, reprintOrder: vi.fn(m.reprintOrder) };
});

import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession, type Role } from "@/lib/auth/roles";
import { invalidateMenu } from "@/lib/menu/cache";
import { approveOrder } from "@/lib/orders/approve-order";
import { rejectOrder } from "@/lib/orders/reject-order";
import { reprintOrder } from "@/lib/orders/reprint";
import { setInitialStock } from "@/lib/stock/movements";
import { redirectOf } from "@/test-support/next-mocks";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { approveOrderAction, rejectOrderAction, reprintOrderAction } from "./actions";

let fx: Fx;
const session = (role: Role, stationId: number | null, userId = fx.userId): AuthSession => ({
  user: { id: userId, name: "U", username: "u", role },
  stationId,
  stationKind: stationId === fx.stationId ? "mostrador" : stationId === fx.otherStationId ? "delivery" : null,
  sessionId: "x",
});
const as = (role: Role, stationId: number | null = fx.stationId, userId?: number) =>
  vi.mocked(requireRole).mockResolvedValue(session(role, stationId, userId));
/** Counter-sector order (takeaway): what a cashier at a Mostrador station may handle. */
const place = (over: { fulfillment?: "delivery" | "takeaway"; paymentMethod?: "cash" | "transfer" } = {}) =>
  placeWebOrder(fx, { fulfillment: "takeaway", ...over });
const status = async (id: number) => (await testDb().select().from(s.orders).where(eq(s.orders.id, id)))[0];
const jobs = () => testDb().select().from(s.printJobs);

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("authorization", () => {
  const calls: [string, (id: number) => Promise<unknown>, () => unknown][] = [
    ["approveOrderAction", (id) => approveOrderAction({ orderId: id, paymentVerified: true }), () => approveOrder],
    ["rejectOrderAction", (id) => rejectOrderAction({ orderId: id, reason: "motivo" }), () => rejectOrder],
    ["reprintOrderAction", (id) => reprintOrderAction({ orderId: id, which: "both" }), () => reprintOrder],
  ];

  it.each(calls)("%s: anonymous is sent to /login and the core is not called", async (_n, run, core) => {
    const o = await place();
    vi.mocked(requireRole).mockRejectedValue(new AuthError("UNAUTHENTICATED"));
    expect(await redirectOf(run(o.id))).toBe("/login");
    expect(core()).not.toHaveBeenCalled();
    expect((await status(o.id)).status).toBe("pendiente_aprobacion");
  });

  it.each(calls)("%s: a role outside the allowed set gets a generic error and the core is not called", async (_n, run, core) => {
    const o = await place();
    vi.mocked(requireRole).mockRejectedValue(new AuthError("FORBIDDEN"));
    const r = (await run(o.id)) as { ok: boolean; message: string };
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/permisos/);
    expect(core()).not.toHaveBeenCalled();
    expect((await status(o.id)).status).toBe("pendiente_aprobacion");
    expect(await jobs()).toHaveLength(0);
  });

  it("requires exactly cajera, encargada_delivery and admin, before anything else", async () => {
    const o = await place();
    as("cajera");
    await approveOrderAction({ orderId: o.id, paymentVerified: false });
    expect(requireRole).toHaveBeenCalledWith("cajera", "encargada_delivery", "admin", "encargado");
  });

  it.each(["cajera", "encargada_delivery", "admin", "encargado"] as const)("%s can approve (an order of their sector)", async (role) => {
    const o = await place({ fulfillment: role === "encargada_delivery" ? "delivery" : "takeaway" });
    as(role, role === "encargada_delivery" ? fx.otherStationId : fx.stationId);
    expect(await approveOrderAction({ orderId: o.id, paymentVerified: false })).toMatchObject({ ok: true });
    expect((await status(o.id)).status).toBe("en_preparacion");
  });
});

describe("approveOrderAction", () => {
  it("takes userId and stationId from the session, ignoring client-sent ones", async () => {
    const o = await place();
    as("cajera", fx.stationId, fx.userId);
    const forged = { orderId: o.id, paymentVerified: false, userId: fx.otherUserId, stationId: fx.otherStationId };
    const r = await approveOrderAction(forged as never);
    expect(r).toMatchObject({ ok: true });
    expect(vi.mocked(approveOrder).mock.calls[0][1]).toEqual({
      orderId: o.id,
      userId: fx.userId,
      stationId: fx.stationId,
      paymentVerified: false,
      sector: "mostrador",
    });
    const row = await status(o.id);
    expect(row.approvedBy).toBe(fx.userId);
    expect(row.stationId).toBe(fx.stationId);
    expect((await jobs()).every((j) => j.stationId === fx.stationId)).toBe(true);
  });

  it("returns serializable data on success", async () => {
    const o = await place();
    as("cajera");
    const r = await approveOrderAction({ orderId: o.id, paymentVerified: false });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(r).toMatchObject({ ok: true, data: { orderId: o.id, number: o.number, printJobIds: expect.any(Array) } });
  });

  it("admin without station -> STATION_REQUIRED result (cannot print), not thrown", async () => {
    const o = await place();
    as("admin", null);
    expect(await approveOrderAction({ orderId: o.id, paymentVerified: false })).toEqual({
      ok: false,
      code: "STATION_REQUIRED",
      message: "Elegí tu estación para imprimir",
    });
  });

  it("transfer without verification is an expected failure result", async () => {
    const o = await place({ paymentMethod: "transfer" });
    as("cajera");
    expect(await approveOrderAction({ orderId: o.id, paymentVerified: false })).toMatchObject({
      ok: false,
      code: "VALIDATION",
    });
    expect(await jobs()).toHaveLength(0);
  });

  it.each([undefined, null, "x", {}, [], { orderId: "1", paymentVerified: true }, { orderId: 1 }, { orderId: -1, paymentVerified: true }])(
    "malformed input %j -> VALIDATION without touching the core",
    async (input) => {
      as("cajera");
      expect(await approveOrderAction(input as never)).toMatchObject({ ok: false, code: "VALIDATION" });
      expect(approveOrder).not.toHaveBeenCalled();
    },
  );

  it("double approval: second call returns INVALID_TRANSITION", async () => {
    const o = await place();
    as("cajera");
    await approveOrderAction({ orderId: o.id, paymentVerified: false });
    expect(await approveOrderAction({ orderId: o.id, paymentVerified: false })).toMatchObject({
      ok: false,
      code: "INVALID_TRANSITION",
    });
    expect(await jobs()).toHaveLength(2); // takeaway at Mostrador: kitchen + customer tickets, not printed twice
  });
});

describe("rejectOrderAction", () => {
  it("rejects with the session user", async () => {
    const o = await place({ fulfillment: "delivery" });
    as("encargada_delivery", fx.otherStationId, fx.otherUserId);
    expect(await rejectOrderAction({ orderId: o.id, reason: "  sin stock  " })).toMatchObject({ ok: true });
    expect(vi.mocked(rejectOrder).mock.calls[0][1]).toEqual({ orderId: o.id, userId: fx.otherUserId, reason: "  sin stock  ", sector: "delivery" });
    const [ev] = (await testDb().select().from(s.orderEvents).where(eq(s.orderEvents.toStatus, "cancelado")));
    expect(ev).toMatchObject({ userId: fx.otherUserId, note: "sin stock" });
  });

  it("validation failure is returned, not thrown", async () => {
    const o = await place();
    as("cajera");
    expect(await rejectOrderAction({ orderId: o.id, reason: "x" })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await rejectOrderAction({ orderId: o.id } as never)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect((await status(o.id)).status).toBe("pendiente_aprobacion");
  });
});

async function linkMeltDrink(units: number) {
  const [item] = await testDb().insert(s.stockItems).values({ name: "Coca 500", kind: "bebida", unit: "u", minQty: 0 }).returning();
  await testDb().update(s.products).set({ stockItemId: item.id }).where(eq(s.products.id, fx.melt));
  const r = await setInitialStock(testDb(), { itemId: item.id, userId: fx.userId, milli: units * 1000 });
  if (!r.ok) throw new Error(r.message);
  return item.id;
}
const qtyOf = async (itemId: number) => (await testDb().select({ q: s.stockItems.quantity }).from(s.stockItems).where(eq(s.stockItems.id, itemId)))[0].q;

describe("rejectOrderAction gives the drinks back", () => {
  it("returns the reserved drink and refreshes the cached menu when it lifts the stock pause", async () => {
    const itemId = await linkMeltDrink(1);
    const o = await place();
    expect(await qtyOf(itemId)).toBe(0);
    as("cajera");
    expect(await rejectOrderAction({ orderId: o.id, reason: "Sin cadete" })).toMatchObject({ ok: true });
    expect(await qtyOf(itemId)).toBe(1000);
    expect(invalidateMenu).toHaveBeenCalledTimes(1);
  });

  it("an order without controlled drinks does not touch the menu cache", async () => {
    const o = await place();
    as("cajera");
    expect(await rejectOrderAction({ orderId: o.id, reason: "Sin cadete" })).toMatchObject({ ok: true });
    expect(invalidateMenu).not.toHaveBeenCalled();
  });
});

describe("reprintOrderAction", () => {
  it("reprints at the session station", async () => {
    const o = await place();
    as("cajera", fx.stationId);
    await approveOrderAction({ orderId: o.id, paymentVerified: false });
    as("cajera", fx.otherStationId);
    // A cashier moved to the other station kind is not a supported combination: the sector rule refuses.
    expect(await reprintOrderAction({ orderId: o.id, which: "customer" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    as("admin", fx.otherStationId);
    const r = await reprintOrderAction({ orderId: o.id, which: "customer", stationId: fx.stationId } as never);
    expect(r).toMatchObject({ ok: true });
    const all = await jobs();
    expect(all).toHaveLength(3); // the takeaway approval printed kitchen + customer; the reprint adds the customer ticket only
    expect(all[0]).toMatchObject({ type: "kitchen", stationId: fx.stationId });
    expect(all[1]).toMatchObject({ type: "customer", stationId: fx.stationId });
    expect(all[2]).toMatchObject({ type: "customer", stationId: fx.otherStationId });
  });

  it("bad `which` -> VALIDATION; pending order -> INVALID_TRANSITION", async () => {
    const o = await place();
    as("cajera");
    expect(await reprintOrderAction({ orderId: o.id, which: "all" } as never)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await reprintOrderAction({ orderId: o.id, which: "both" })).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
  });
});

describe("unexpected errors", () => {
  it.each([
    ["approve", () => approveOrderAction({ orderId: 1, paymentVerified: true }), approveOrder],
    ["reject", () => rejectOrderAction({ orderId: 1, reason: "motivo" }), rejectOrder],
    ["reprint", () => reprintOrderAction({ orderId: 1, which: "both" }), reprintOrder],
  ] as const)("%s: a throwing core becomes a fixed generic message and leaks nothing", async (_n, run, core) => {
    as("cajera");
    const secret = 'duplicate key value violates "orders_pkey" at SELECT * FROM orders';
    (core as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error(secret), { code: "23505" }));
    const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "log"), vi.spyOn(console, "warn")].map((spy) => spy.mockImplementation(() => {}));
    const r = await run();
    expect(r).toEqual({ ok: false, code: "UNEXPECTED", message: "No se pudo completar la acción. Probá de nuevo." });
    const logged = JSON.stringify(logs.map((l) => l.mock.calls));
    expect(logged).not.toContain("orders_pkey");
    expect(logged).not.toContain("SELECT");
    expect(logged).toContain("23505");
  });
});

describe("module shape", () => {
  it("exports only async functions at runtime", async () => {
    const mod = await import("./actions");
    for (const [name, value] of Object.entries(mod)) {
      expect(typeof value, name).toBe("function");
      expect(value.constructor.name, name).toBe("AsyncFunction");
    }
    expect(Object.keys(mod).sort()).toEqual(["approveOrderAction", "rejectOrderAction", "reprintOrderAction"]);
  });
});

describe("sector rule (server side)", () => {
  it.each([
    ["cajera at a Mostrador station", "cajera", "mostrador", "delivery"],
    ["encargada at a Delivery station", "encargada_delivery", "delivery", "takeaway"],
  ] as const)("%s: approve/reject on the other sector's order -> WRONG_SECTOR, nothing written", async (_n, role, kind, orderKind) => {
    const o = await place({ fulfillment: orderKind });
    as(role, kind === "mostrador" ? fx.stationId : fx.otherStationId);
    expect(await approveOrderAction({ orderId: o.id, paymentVerified: true })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await rejectOrderAction({ orderId: o.id, reason: "motivo" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect((await status(o.id)).status).toBe("pendiente_aprobacion");
    expect(await jobs()).toHaveLength(0);
    expect(await testDb().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, o.id))).toHaveLength(1);
  });

  it("reprint of the other sector's approved order -> WRONG_SECTOR, no job queued", async () => {
    const o = await place({ fulfillment: "delivery" });
    as("admin", fx.stationId);
    await approveOrderAction({ orderId: o.id, paymentVerified: true });
    const before = (await jobs()).length;
    as("cajera", fx.stationId);
    expect(await reprintOrderAction({ orderId: o.id, which: "both" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await jobs()).toHaveLength(before);
  });

  it("admin is exempt: approves a delivery order from any station", async () => {
    const o = await place({ fulfillment: "delivery" });
    as("admin", fx.stationId);
    expect(await approveOrderAction({ orderId: o.id, paymentVerified: true })).toMatchObject({ ok: true });
    expect(vi.mocked(approveOrder).mock.calls[0][1]).toMatchObject({ sector: null });
  });

  it.each(["cajera", "encargada_delivery"] as const)("%s without a station is refused before the core (STATION_REQUIRED)", async (role) => {
    const o = await place();
    as(role, null);
    expect(await approveOrderAction({ orderId: o.id, paymentVerified: true })).toMatchObject({ ok: false, code: "STATION_REQUIRED" });
    expect(await rejectOrderAction({ orderId: o.id, reason: "motivo" })).toMatchObject({ ok: false, code: "STATION_REQUIRED" });
    expect(await reprintOrderAction({ orderId: o.id, which: "both" })).toMatchObject({ ok: false, code: "STATION_REQUIRED" });
    expect(approveOrder).not.toHaveBeenCalled();
    expect(rejectOrder).not.toHaveBeenCalled();
    expect(reprintOrder).not.toHaveBeenCalled();
  });
});

describe("role/station-kind mismatch is refused before any write", () => {
  it.each([
    ["cajera at a Delivery station", "cajera", "delivery"],
    ["encargada at a Mostrador station", "encargada_delivery", "takeaway"],
  ] as const)("%s cannot approve even an order of the station's own kind", async (_n, role, orderKind) => {
    const o = await place({ fulfillment: orderKind === "delivery" ? "delivery" : "takeaway" });
    as(role, role === "cajera" ? fx.otherStationId : fx.stationId);
    expect(await approveOrderAction({ orderId: o.id, paymentVerified: true })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await rejectOrderAction({ orderId: o.id, reason: "motivo" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(approveOrder).not.toHaveBeenCalled();
    expect((await status(o.id)).status).toBe("pendiente_aprobacion");
    expect(await jobs()).toHaveLength(0);
  });
});
