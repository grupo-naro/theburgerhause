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
import { approveOrder } from "@/lib/orders/approve-order";
import { rejectOrder } from "@/lib/orders/reject-order";
import { reprintOrder } from "@/lib/orders/reprint";
import { redirectOf } from "@/test-support/next-mocks";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { approveOrderAction, rejectOrderAction, reprintOrderAction } from "./actions";

let fx: Fx;
const session = (role: Role, stationId: number | null, userId = fx.userId): AuthSession => ({
  user: { id: userId, name: "U", username: "u", role },
  stationId,
  sessionId: "x",
});
const as = (role: Role, stationId: number | null = fx.stationId, userId?: number) =>
  vi.mocked(requireRole).mockResolvedValue(session(role, stationId, userId));
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
    const o = await placeWebOrder(fx);
    vi.mocked(requireRole).mockRejectedValue(new AuthError("UNAUTHENTICATED"));
    expect(await redirectOf(run(o.id))).toBe("/login");
    expect(core()).not.toHaveBeenCalled();
    expect((await status(o.id)).status).toBe("pendiente_aprobacion");
  });

  it.each(calls)("%s: a role outside the allowed set gets a generic error and the core is not called", async (_n, run, core) => {
    const o = await placeWebOrder(fx);
    vi.mocked(requireRole).mockRejectedValue(new AuthError("FORBIDDEN"));
    const r = (await run(o.id)) as { ok: boolean; message: string };
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/permisos/);
    expect(core()).not.toHaveBeenCalled();
    expect((await status(o.id)).status).toBe("pendiente_aprobacion");
    expect(await jobs()).toHaveLength(0);
  });

  it("requires exactly cajera, encargada_delivery and admin, before anything else", async () => {
    const o = await placeWebOrder(fx);
    as("cajera");
    await approveOrderAction({ orderId: o.id, paymentVerified: false });
    expect(requireRole).toHaveBeenCalledWith("cajera", "encargada_delivery", "admin");
  });

  it.each(["cajera", "encargada_delivery", "admin"] as const)("%s can approve", async (role) => {
    const o = await placeWebOrder(fx);
    as(role);
    expect(await approveOrderAction({ orderId: o.id, paymentVerified: false })).toMatchObject({ ok: true });
    expect((await status(o.id)).status).toBe("en_preparacion");
  });
});

describe("approveOrderAction", () => {
  it("takes userId and stationId from the session, ignoring client-sent ones", async () => {
    const o = await placeWebOrder(fx);
    as("cajera", fx.stationId, fx.userId);
    const forged = { orderId: o.id, paymentVerified: false, userId: fx.otherUserId, stationId: fx.otherStationId };
    const r = await approveOrderAction(forged as never);
    expect(r).toMatchObject({ ok: true });
    expect(vi.mocked(approveOrder).mock.calls[0][1]).toEqual({
      orderId: o.id,
      userId: fx.userId,
      stationId: fx.stationId,
      paymentVerified: false,
    });
    const row = await status(o.id);
    expect(row.approvedBy).toBe(fx.userId);
    expect(row.stationId).toBe(fx.stationId);
    expect((await jobs()).every((j) => j.stationId === fx.stationId)).toBe(true);
  });

  it("returns serializable data on success", async () => {
    const o = await placeWebOrder(fx);
    as("cajera");
    const r = await approveOrderAction({ orderId: o.id, paymentVerified: false });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(r).toMatchObject({ ok: true, data: { orderId: o.id, number: o.number, printJobIds: expect.any(Array) } });
  });

  it("session without station -> STATION_REQUIRED result, not thrown", async () => {
    const o = await placeWebOrder(fx);
    as("cajera", null);
    expect(await approveOrderAction({ orderId: o.id, paymentVerified: false })).toEqual({
      ok: false,
      code: "STATION_REQUIRED",
      message: "Elegí tu estación para imprimir",
    });
  });

  it("transfer without verification is an expected failure result", async () => {
    const o = await placeWebOrder(fx, { paymentMethod: "transfer" });
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
    const o = await placeWebOrder(fx);
    as("cajera");
    await approveOrderAction({ orderId: o.id, paymentVerified: false });
    expect(await approveOrderAction({ orderId: o.id, paymentVerified: false })).toMatchObject({
      ok: false,
      code: "INVALID_TRANSITION",
    });
    expect(await jobs()).toHaveLength(2);
  });
});

describe("rejectOrderAction", () => {
  it("rejects with the session user", async () => {
    const o = await placeWebOrder(fx);
    as("encargada_delivery", null, fx.otherUserId);
    expect(await rejectOrderAction({ orderId: o.id, reason: "  sin stock  " })).toMatchObject({ ok: true });
    expect(vi.mocked(rejectOrder).mock.calls[0][1]).toEqual({ orderId: o.id, userId: fx.otherUserId, reason: "  sin stock  " });
    const [ev] = (await testDb().select().from(s.orderEvents).where(eq(s.orderEvents.toStatus, "cancelado")));
    expect(ev).toMatchObject({ userId: fx.otherUserId, note: "sin stock" });
  });

  it("validation failure is returned, not thrown", async () => {
    const o = await placeWebOrder(fx);
    as("cajera");
    expect(await rejectOrderAction({ orderId: o.id, reason: "x" })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await rejectOrderAction({ orderId: o.id } as never)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect((await status(o.id)).status).toBe("pendiente_aprobacion");
  });
});

describe("reprintOrderAction", () => {
  it("reprints at the session station", async () => {
    const o = await placeWebOrder(fx);
    as("cajera", fx.stationId);
    await approveOrderAction({ orderId: o.id, paymentVerified: false });
    as("cajera", fx.otherStationId);
    const r = await reprintOrderAction({ orderId: o.id, which: "kitchen", stationId: fx.stationId } as never);
    expect(r).toMatchObject({ ok: true });
    const all = await jobs();
    expect(all).toHaveLength(3);
    expect(all[2]).toMatchObject({ type: "kitchen", stationId: fx.otherStationId });
  });

  it("bad `which` -> VALIDATION; pending order -> INVALID_TRANSITION", async () => {
    const o = await placeWebOrder(fx);
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
