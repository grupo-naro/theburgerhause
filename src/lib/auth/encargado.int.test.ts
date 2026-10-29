import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));

import { closeDb } from "@/db/client";
import { resetDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession, type Role } from "@/lib/auth/roles";
import { approveOrderAction } from "@/app/(staff)/caja/actions";
import {
  assignCadetAction,
  cancelOrderAction,
  markDeliveredAction,
  markPickupAction,
  markReadyAction,
} from "@/app/(staff)/despacho/actions";
import { makeCadet, orderEventsOf, orderRow, preparingWebOrder } from "@/test-support/dispatch";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";

let fx: Fx;
/** The `encargado` works with NO station (like admin): stationId / stationKind null. */
const session = (role: Role, station: "mostrador" | "delivery" | null = null): AuthSession => ({
  user: { id: fx.userId, name: "E", username: "e", role },
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

import { testDb } from "@/db/test-utils";
import * as s from "@/db/schema";

describe("encargado: staff access in every sector, without a station", () => {
  it("approves a web order of delivery and one of takeaway from a single station (printing needs one, like admin)", async () => {
    as("encargado", "mostrador");
    const d = await placeWebOrder(fx, { fulfillment: "delivery" });
    const t = await placeWebOrder(fx, { fulfillment: "takeaway" });
    for (const o of [d, t]) {
      expect(await approveOrderAction({ orderId: o.id, paymentVerified: false, expectedTotal: o.total })).toMatchObject({ ok: true });
      expect((await orderRow(o.id)).status).toBe("en_preparacion");
    }
  });

  it("marks ready (delivery) and pickup (takeaway)", async () => {
    as("encargado");
    const d = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const t = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    expect(await markReadyAction({ orderId: d.id })).toMatchObject({ ok: true });
    expect((await orderRow(d.id)).status).toBe("listo_despacho");
    expect(await markReadyAction({ orderId: t.id })).toMatchObject({ ok: true });
    expect(await markPickupAction({ orderId: t.id })).toMatchObject({ ok: true });
    expect((await orderRow(t.id)).status).toBe("para_retirar");
  });

  it("cancels with a mandatory reason, in either sector", async () => {
    as("encargado");
    const d = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const t = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    expect(await cancelOrderAction({ orderId: d.id, reason: "  " })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await cancelOrderAction({ orderId: d.id, reason: "Sin cadete" })).toMatchObject({ ok: true, data: { status: "cancelado" } });
    expect(await cancelOrderAction({ orderId: t.id, reason: "Cliente canceló" })).toMatchObject({ ok: true });
    expect((await orderEventsOf(t.id)).at(-1)).toMatchObject({ toStatus: "cancelado", userId: fx.userId, note: "Cliente canceló" });
  });

  it("dispatches a delivery order: assign a cadet and mark delivered", async () => {
    as("encargado");
    const d = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const cadet = await makeCadet();
    await markReadyAction({ orderId: d.id });
    expect(await assignCadetAction({ orderIds: [d.id], cadetId: cadet.id })).toMatchObject({ ok: true });
    expect(await markDeliveredAction({ orderId: d.id })).toMatchObject({ ok: true });
    expect((await orderRow(d.id)).status).toBe("entregado");
  });

  it("the cashier stays restricted to her sector (control)", async () => {
    as("cajera", "mostrador");
    const d = await preparingWebOrder(fx, { fulfillment: "delivery" });
    expect(await cancelOrderAction({ orderId: d.id, reason: "motivo" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect((await orderRow(d.id)).status).toBe("en_preparacion");
  });

  it("a role outside the allowed set is refused before touching the order", async () => {
    const d = await preparingWebOrder(fx, { fulfillment: "delivery" });
    as("cocina");
    expect(await cancelOrderAction({ orderId: d.id, reason: "motivo" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await markReadyAction({ orderId: d.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await orderRow(d.id)).status).toBe("en_preparacion");
  });
});

describe("encargado: persisted role (migration 0008)", () => {
  it("a user can be stored with the encargado role", async () => {
    const [u] = await testDb().insert(s.users).values({ name: "Enc", username: "enc", passwordHash: "x", role: "encargado" }).returning({ role: s.users.role });
    expect(u.role).toBe("encargado");
  });
});
