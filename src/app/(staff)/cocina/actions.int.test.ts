import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/orders/dispatch", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/orders/dispatch")>();
  return { ...m, markReady: vi.fn(m.markReady) };
});
vi.mock("@/lib/orders/undo-ready", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/orders/undo-ready")>();
  return { ...m, undoReady: vi.fn(m.undoReady) };
});

import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession, type Role } from "@/lib/auth/roles";
import * as dispatch from "@/lib/orders/dispatch";
import * as undoMod from "@/lib/orders/undo-ready";
import { redirectOf } from "@/test-support/next-mocks";
import { orderEventsOf, orderRow, preparingCounterOrder, preparingWebOrder } from "@/test-support/dispatch";
import { seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { kitchenReadyAction, kitchenUndoAction } from "./actions";

let fx: Fx;
const session = (role: Role, station: "mostrador" | "delivery" | null = null, userId = fx.userId): AuthSession => ({
  user: { id: userId, name: "U", username: "u", role },
  stationId: station === "mostrador" ? fx.stationId : station === "delivery" ? fx.otherStationId : null,
  stationKind: station,
  sessionId: "x",
});
/** Mimics the real requireRole: the session is returned only when its role is allowed. */
const as = (role: Role, station: "mostrador" | "delivery" | null = null) =>
  vi.mocked(requireRole).mockImplementation(async (...allowed: Role[]) => {
    if (!allowed.includes(role)) throw new AuthError("FORBIDDEN");
    return session(role, station);
  });

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("authorization (before any DB work)", () => {
  const calls: [string, (id: number) => Promise<unknown>, () => unknown][] = [
    ["kitchenReadyAction", (id) => kitchenReadyAction({ orderId: id }), () => dispatch.markReady],
    ["kitchenUndoAction", (id) => kitchenUndoAction({ orderId: id }), () => undoMod.undoReady],
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

  it("allows exactly cocina, cajera, encargada_delivery, admin and encargado", async () => {
    as("admin");
    await kitchenReadyAction({ orderId: 1 });
    expect(vi.mocked(requireRole).mock.calls.at(-1)).toEqual(["cocina", "cajera", "encargada_delivery", "admin", "encargado"]);
    await kitchenUndoAction({ orderId: 1 });
    expect(vi.mocked(requireRole).mock.calls.at(-1)).toEqual(["cocina", "cajera", "encargada_delivery", "admin", "encargado"]);
  });
});

describe("kitchenReadyAction", () => {
  it("cocina (no station) marks a delivery order and a takeaway order ready: the sector rule does not apply to the kitchen", async () => {
    as("cocina");
    const d = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const t = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    const c = await preparingCounterOrder(fx, { pagerNumber: 5 });
    for (const o of [d, t, c]) {
      expect(await kitchenReadyAction({ orderId: o.id })).toMatchObject({ ok: true, data: { orderId: o.id, status: "listo_despacho" } });
      expect((await orderRow(o.id)).status).toBe("listo_despacho");
    }
  });

  it("writes the audit event with the cook as the actor", async () => {
    as("cocina");
    const u = fx.otherUserId;
    vi.mocked(requireRole).mockImplementation(async () => session("cocina", null, u));
    const o = await preparingWebOrder(fx);
    await kitchenReadyAction({ orderId: o.id });
    expect((await orderEventsOf(o.id)).at(-1)).toMatchObject({ fromStatus: "en_preparacion", toStatus: "listo_despacho", userId: u });
  });

  it("double call: the second one is the friendly 'ya no está en preparación' and exactly one event is written", async () => {
    as("cocina");
    const o = await preparingWebOrder(fx);
    const before = (await orderEventsOf(o.id)).length;
    const [a, b] = await Promise.all([kitchenReadyAction({ orderId: o.id }), kitchenReadyAction({ orderId: o.id })]);
    const results = [a, b] as { ok: boolean; code?: string; message?: string }[];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok)!;
    expect(failed).toMatchObject({ code: "NOT_IN_PREPARATION" });
    expect(failed.message).toMatch(/ya no está en preparación/);
    expect(await orderEventsOf(o.id)).toHaveLength(before + 1);
  });

  it("a cancelled order answers the same friendly code (no 500)", async () => {
    as("cocina");
    const o = await preparingWebOrder(fx);
    await testDb().update(s.orders).set({ status: "cancelado" }).where(eq(s.orders.id, o.id));
    expect(await kitchenReadyAction({ orderId: o.id })).toMatchObject({ ok: false, code: "NOT_IN_PREPARATION" });
  });

  it("an unknown order and a malformed payload", async () => {
    as("cocina");
    expect(await kitchenReadyAction({ orderId: 999_999 })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await kitchenReadyAction({ orderId: "1" })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await kitchenReadyAction(null)).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("other roles keep the sector rule: the cashier at Mostrador cannot mark a delivery order, needs a station, and admin is exempt", async () => {
    const d = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const t = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    as("cajera", "mostrador");
    expect(await kitchenReadyAction({ orderId: d.id })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await kitchenReadyAction({ orderId: t.id })).toMatchObject({ ok: true });
    as("cajera", null);
    expect(await kitchenReadyAction({ orderId: d.id })).toMatchObject({ ok: false, code: "STATION_REQUIRED" });
    as("encargada_delivery", "delivery");
    expect(await kitchenReadyAction({ orderId: d.id })).toMatchObject({ ok: true });
    expect((await orderRow(d.id)).status).toBe("listo_despacho");
    const d2 = await preparingWebOrder(fx, { fulfillment: "delivery" });
    as("admin");
    expect(await kitchenReadyAction({ orderId: d2.id })).toMatchObject({ ok: true });
  });
});

describe("kitchenUndoAction", () => {
  it("puts a ready order back in preparation (cocina, any sector)", async () => {
    as("cocina");
    const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
    await kitchenReadyAction({ orderId: o.id });
    expect(await kitchenUndoAction({ orderId: o.id })).toMatchObject({ ok: true, data: { status: "en_preparacion" } });
    expect((await orderRow(o.id)).status).toBe("en_preparacion");
  });

  it("is refused with the core's clear message once the pager was called, and writes nothing", async () => {
    as("cocina");
    const o = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    await kitchenReadyAction({ orderId: o.id });
    await dispatch.markPickup(testDb(), { sector: null, orderId: o.id, userId: fx.userId });
    const events = (await orderEventsOf(o.id)).length;
    const r = (await kitchenUndoAction({ orderId: o.id })) as { ok: boolean; code: string; message: string };
    expect(r).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
    expect(r.message).toMatch(/avisad/);
    expect(await orderEventsOf(o.id)).toHaveLength(events);
  });

  it("undo from a second screen when the order is already back in preparation: friendly ALREADY_IN_PREPARATION", async () => {
    as("cocina");
    const o = await preparingWebOrder(fx);
    await kitchenReadyAction({ orderId: o.id });
    await kitchenUndoAction({ orderId: o.id });
    const r = (await kitchenUndoAction({ orderId: o.id })) as { ok: boolean; code: string; message: string };
    expect(r).toMatchObject({ ok: false, code: "ALREADY_IN_PREPARATION" });
    expect(r.message).toBe("Ese pedido ya está en preparación.");
  });

  it("the cashier at Mostrador cannot undo a delivery order", async () => {
    as("cocina");
    const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
    await kitchenReadyAction({ orderId: o.id });
    as("cajera", "mostrador");
    expect(await kitchenUndoAction({ orderId: o.id })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
  });
});
