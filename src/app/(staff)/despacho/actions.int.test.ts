import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/orders/dispatch", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/orders/dispatch")>();
  return {
    ...m,
    markReady: vi.fn(m.markReady),
    markPickup: vi.fn(m.markPickup),
    markDelivered: vi.fn(m.markDelivered),
    returnToDispatch: vi.fn(m.returnToDispatch),
    assignCadet: vi.fn(m.assignCadet),
  };
});

import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession, type Role } from "@/lib/auth/roles";
import * as dispatch from "@/lib/orders/dispatch";
import { redirectOf } from "@/test-support/next-mocks";
import { makeCadet, preparingWebOrder } from "@/test-support/dispatch";
import { seedMenuAndStaff, type Fx } from "@/test-support/orders";
import {
  assignCadetAction,
  markDeliveredAction,
  markPickupAction,
  markReadyAction,
  returnToDispatchAction,
} from "./actions";

let fx: Fx;
const session = (role: Role, userId = fx.userId): AuthSession => ({
  user: { id: userId, name: "U", username: "u", role },
  stationId: null,
  sessionId: "x",
});
/** Mimics the real requireRole: the session is returned only when its role is allowed. */
const as = (role: Role, userId?: number) =>
  vi.mocked(requireRole).mockImplementation(async (...allowed: Role[]) => {
    if (!allowed.includes(role)) throw new AuthError("FORBIDDEN");
    return session(role, userId);
  });
const row = async (id: number) => (await testDb().select().from(s.orders).where(eq(s.orders.id, id)))[0];
const events = (id: number) => testDb().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, id)).orderBy(s.orderEvents.id);

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

const ROLES: Role[] = ["cajera", "encargada_delivery", "admin"];

describe("authorization", () => {
  const calls: [string, (id: number) => Promise<unknown>, () => unknown][] = [
    ["markReadyAction", (id) => markReadyAction({ orderId: id }), () => dispatch.markReady],
    ["markPickupAction", (id) => markPickupAction({ orderId: id }), () => dispatch.markPickup],
    ["markDeliveredAction", (id) => markDeliveredAction({ orderId: id }), () => dispatch.markDelivered],
    ["returnToDispatchAction", (id) => returnToDispatchAction({ orderId: id, reason: "motivo" }), () => dispatch.returnToDispatch],
    ["assignCadetAction", (id) => assignCadetAction({ orderIds: [id], cadetId: 1 }), () => dispatch.assignCadet],
  ];

  it.each(calls)("%s: anonymous is sent to /login and the core is not called", async (_n, run, core) => {
    vi.mocked(requireRole).mockRejectedValue(new AuthError("UNAUTHENTICATED"));
    expect(await redirectOf(run(1))).toBe("/login");
    expect(core()).not.toHaveBeenCalled();
  });

  it.each(calls)("%s: a forbidden role gets a generic error and the core is not called", async (_n, run, core) => {
    vi.mocked(requireRole).mockRejectedValue(new AuthError("FORBIDDEN"));
    const r = (await run(1)) as { ok: boolean; code: string; message: string };
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(r.message).toMatch(/permisos/);
    expect(core()).not.toHaveBeenCalled();
  });

  it("the four order actions require cajera, encargada_delivery and admin; assign excludes the cajera", async () => {
    as("admin");
    await markReadyAction({ orderId: 1 });
    await markPickupAction({ orderId: 1 });
    await markDeliveredAction({ orderId: 1 });
    await returnToDispatchAction({ orderId: 1, reason: "motivo" });
    expect(vi.mocked(requireRole).mock.calls).toEqual(Array(4).fill(["cajera", "encargada_delivery", "admin"]));
    vi.mocked(requireRole).mockClear();
    await assignCadetAction({ orderIds: [1], cadetId: 1 });
    expect(vi.mocked(requireRole).mock.calls).toEqual([["encargada_delivery", "admin"]]);
  });

  it("assign is rejected for the cajera (core not called) and allowed for encargada and admin", async () => {
    const cadet = await makeCadet();
    const o = await preparingWebOrder(fx);
    await dispatch.markReady(testDb(), { orderId: o.id, userId: fx.userId });
    vi.mocked(dispatch.markReady).mockClear();

    as("cajera");
    expect(await assignCadetAction({ orderIds: [o.id], cadetId: cadet.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(dispatch.assignCadet).not.toHaveBeenCalled();
    expect((await row(o.id)).status).toBe("listo_despacho");

    as("encargada_delivery");
    expect(await assignCadetAction({ orderIds: [o.id], cadetId: cadet.id })).toMatchObject({ ok: true });
    expect((await row(o.id)).status).toBe("en_camino");

    await testDb().update(s.orders).set({ status: "listo_despacho", cadetId: null }).where(eq(s.orders.id, o.id));
    as("admin");
    expect(await assignCadetAction({ orderIds: [o.id], cadetId: cadet.id })).toMatchObject({ ok: true });
  });

  it.each(ROLES)("%s can run the four order actions", async (role) => {
    as(role);
    const o = await preparingWebOrder(fx, { fulfillment: "takeaway", paymentMethod: "transfer" });
    expect(await markReadyAction({ orderId: o.id })).toMatchObject({ ok: true, data: { status: "listo_despacho" } });
    expect(await markPickupAction({ orderId: o.id })).toMatchObject({ ok: true, data: { status: "para_retirar" } });
    expect(await markDeliveredAction({ orderId: o.id })).toMatchObject({ ok: true, data: { status: "entregado" } });
    const d = await preparingWebOrder(fx, { fulfillment: "delivery" });
    await markReadyAction({ orderId: d.id });
    await testDb().update(s.orders).set({ status: "en_camino" }).where(eq(s.orders.id, d.id));
    expect(await returnToDispatchAction({ orderId: d.id, reason: "no estaba" })).toMatchObject({ ok: true });
  });
});

describe("session identity and payload hygiene", () => {
  it("takes userId from the session, ignoring a client-sent one; extra fields are stripped", async () => {
    const o = await preparingWebOrder(fx);
    as("cajera", fx.otherUserId);
    const forged = { orderId: o.id, userId: fx.userId, status: "entregado", total: 1 };
    expect(await markReadyAction(forged as never)).toMatchObject({ ok: true });
    expect(vi.mocked(dispatch.markReady).mock.calls[0][1]).toEqual({ orderId: o.id, userId: fx.otherUserId });
    expect((await events(o.id)).at(-1)).toMatchObject({ userId: fx.otherUserId, toStatus: "listo_despacho" });
  });

  it("assign: userId from session, extra fields stripped, success is serializable", async () => {
    const cadet = await makeCadet("Nahuel");
    const o = await preparingWebOrder(fx);
    await dispatch.markReady(testDb(), { orderId: o.id, userId: fx.userId });
    as("encargada_delivery", fx.otherUserId);
    const r = await assignCadetAction({ orderIds: [o.id, o.id], cadetId: cadet.id, userId: fx.userId, cashToCollect: 0 } as never);
    expect(r).toMatchObject({ ok: true, data: { count: 1, cadet: { name: "Nahuel" } } });
    expect(vi.mocked(dispatch.assignCadet).mock.calls[0][1]).toEqual({ orderIds: [o.id, o.id], cadetId: cadet.id, userId: fx.otherUserId });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect((await events(o.id)).at(-1)).toMatchObject({ userId: fx.otherUserId });
  });

  it("collected travels to markDelivered; a takeaway cash order needs it", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "takeaway", paymentMethod: "cash" });
    as("cajera");
    await markReadyAction({ orderId: o.id });
    await markPickupAction({ orderId: o.id });
    expect(await markDeliveredAction({ orderId: o.id })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await markDeliveredAction({ orderId: o.id, collected: "yes" } as never)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await markDeliveredAction({ orderId: o.id, collected: true })).toMatchObject({ ok: true, data: { paymentStatus: "paid" } });
  });

  it.each([undefined, null, "x", {}, [], { orderId: "1" }, { orderId: -1 }, { orderId: 1.5 }])(
    "malformed input %j -> VALIDATION without touching the core",
    async (input) => {
      as("cajera");
      expect(await markReadyAction(input as never)).toMatchObject({ ok: false, code: "VALIDATION" });
      expect(await markPickupAction(input as never)).toMatchObject({ ok: false, code: "VALIDATION" });
      expect(await markDeliveredAction(input as never)).toMatchObject({ ok: false, code: "VALIDATION" });
      expect(dispatch.markReady).not.toHaveBeenCalled();
      expect(dispatch.markPickup).not.toHaveBeenCalled();
      expect(dispatch.markDelivered).not.toHaveBeenCalled();
    },
  );

  it("assign: bad payloads are VALIDATION (empty, 51 ids, non-array, bad cadet)", async () => {
    as("admin");
    for (const bad of [
      { orderIds: [], cadetId: 1 },
      { orderIds: Array.from({ length: 51 }, (_, i) => i + 1), cadetId: 1 },
      { orderIds: "1", cadetId: 1 },
      { orderIds: [1], cadetId: 0 },
      { orderIds: [1] },
      null,
    ]) {
      expect(await assignCadetAction(bad as never)).toMatchObject({ ok: false, code: "VALIDATION" });
    }
    expect(dispatch.assignCadet).not.toHaveBeenCalled();
  });

  it("return: reason is required", async () => {
    as("cajera");
    expect(await returnToDispatchAction({ orderId: 1 } as never)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(dispatch.returnToDispatch).not.toHaveBeenCalled();
  });
});

describe("expected failures are returned, not thrown", () => {
  it("invalid transition and assignment details come back as results", async () => {
    const takeaway = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    await dispatch.markReady(testDb(), { orderId: takeaway.id, userId: fx.userId });
    const cadet = await makeCadet();
    as("encargada_delivery");
    expect(await markReadyAction({ orderId: takeaway.id })).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    const r = await assignCadetAction({ orderIds: [takeaway.id], cadetId: cadet.id });
    expect(r).toMatchObject({ ok: false, code: "NOT_DELIVERY", details: [{ orderId: takeaway.id, orderNumber: takeaway.number }] });
    expect(await assignCadetAction({ orderIds: [takeaway.id], cadetId: 999 })).toMatchObject({ ok: false, code: "CADET_NOT_FOUND" });
  });
});

describe("unexpected errors", () => {
  it.each([
    ["ready", () => markReadyAction({ orderId: 1 }), () => dispatch.markReady],
    ["pickup", () => markPickupAction({ orderId: 1 }), () => dispatch.markPickup],
    ["delivered", () => markDeliveredAction({ orderId: 1 }), () => dispatch.markDelivered],
    ["return", () => returnToDispatchAction({ orderId: 1, reason: "motivo" }), () => dispatch.returnToDispatch],
    ["assign", () => assignCadetAction({ orderIds: [1], cadetId: 1 }), () => dispatch.assignCadet],
  ] as const)("%s: a throwing core becomes a fixed generic message and leaks nothing", async (_n, run, core) => {
    as("admin");
    const secret = 'duplicate key value violates "orders_pkey" at SELECT * FROM orders';
    (core() as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error(secret), { code: "23505" }));
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
    expect(Object.keys(mod).sort()).toEqual([
      "assignCadetAction",
      "markDeliveredAction",
      "markPickupAction",
      "markReadyAction",
      "returnToDispatchAction",
    ]);
  });
});
