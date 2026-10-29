import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/menu/cache", () => ({ invalidateMenu: vi.fn(), MENU_CACHE_TAG: "menu" }));
vi.mock("@/lib/orders/order-edit", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/orders/order-edit")>();
  return { ...m, editPendingOrder: vi.fn(m.editPendingOrder) };
});
vi.mock("@/lib/orders/addons", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/orders/addons")>();
  return { ...m, addOrderAddon: vi.fn(m.addOrderAddon), confirmAddon: vi.fn(m.confirmAddon), cancelAddon: vi.fn(m.cancelAddon) };
});
vi.mock("@/lib/orders/reprint", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/orders/reprint")>();
  return { ...m, reprintAddonTicket: vi.fn(m.reprintAddonTicket) };
});

import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession, type Role } from "@/lib/auth/roles";
import { addOrderAddon, cancelAddon, confirmAddon } from "@/lib/orders/addons";
import { editPendingOrder } from "@/lib/orders/order-edit";
import { reprintAddonTicket } from "@/lib/orders/reprint";
import { redirectOf } from "@/test-support/next-mocks";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { preparingWebOrder } from "@/test-support/dispatch";
import { addAddonAction, cancelAddonAction, confirmAddonAction, editPendingOrderAction, reprintAddonAction } from "./actions";

let fx: Fx;
const session = (role: Role, stationId: number | null, userId = fx.userId): AuthSession => ({
  user: { id: userId, name: "U", username: "u", role },
  stationId,
  stationKind: stationId === fx.stationId ? "mostrador" : stationId === fx.otherStationId ? "delivery" : null,
  sessionId: "x",
});
const as = (role: Role, stationId: number | null = fx.stationId, userId?: number) =>
  vi.mocked(requireRole).mockResolvedValue(session(role, stationId, userId));
const unit = (productId: number) => ({ productId, modifierIds: [], note: "" });
const orders = (id: number) => testDb().select().from(s.orders).where(eq(s.orders.id, id));

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

const calls = (orderId: number, addonId = 1) => [
  ["editPendingOrderAction", () => editPendingOrderAction({ orderId, removeItemIds: [], addUnits: [unit(fx.melt)] }), () => editPendingOrder],
  ["addAddonAction", () => addAddonAction({ orderId, units: [unit(fx.melt)], idempotencyKey: randomUUID() }), () => addOrderAddon],
  ["confirmAddonAction", () => confirmAddonAction({ addonId, paymentVerified: true }), () => confirmAddon],
  ["cancelAddonAction", () => cancelAddonAction({ addonId }), () => cancelAddon],
  ["reprintAddonAction", () => reprintAddonAction({ orderId, addonSeq: 1 }), () => reprintAddonTicket],
] as const;

describe("authorization", () => {
  it("cocina cannot run any of the actions (FORBIDDEN, core untouched)", async () => {
    const o = await placeWebOrder(fx, { fulfillment: "takeaway" });
    vi.mocked(requireRole).mockRejectedValue(new AuthError("FORBIDDEN"));
    for (const [, run, core] of calls(o.id)) {
      expect(await run()).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(core()).not.toHaveBeenCalled();
    }
  });

  it("anonymous is sent to /login", async () => {
    const o = await placeWebOrder(fx, { fulfillment: "takeaway" });
    vi.mocked(requireRole).mockRejectedValue(new AuthError("UNAUTHENTICATED"));
    for (const [, run, core] of calls(o.id)) {
      expect(await redirectOf(run())).toBe("/login");
      expect(core()).not.toHaveBeenCalled();
    }
  });

  it("requires exactly cajera, encargada_delivery, admin and encargado", async () => {
    const o = await placeWebOrder(fx, { fulfillment: "takeaway" });
    as("cajera");
    await editPendingOrderAction({ orderId: o.id, removeItemIds: [], addUnits: [unit(fx.melt)] });
    expect(requireRole).toHaveBeenCalledWith("cajera", "encargada_delivery", "admin", "encargado");
  });
});

describe("sector rule", () => {
  it("a cashier at the counter cannot touch a delivery order (WRONG_SECTOR)", async () => {
    const o = await placeWebOrder(fx, { fulfillment: "delivery" });
    as("cajera", fx.stationId);
    expect(await editPendingOrderAction({ orderId: o.id, removeItemIds: [], addUnits: [unit(fx.melt)] })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    const p = await preparingWebOrder(fx, { fulfillment: "delivery" });
    expect(await addAddonAction({ orderId: p.id, units: [unit(fx.melt)], idempotencyKey: randomUUID() })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await reprintAddonAction({ orderId: p.id, addonSeq: 1 })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
  });
});

describe("editPendingOrderAction", () => {
  it("edits the order and takes the user from the session, ignoring a forged userId", async () => {
    const o = await placeWebOrder(fx, { fulfillment: "takeaway" });
    as("cajera", fx.stationId, fx.userId);
    const forged = { orderId: o.id, removeItemIds: [], addUnits: [unit(fx.melt)], userId: fx.otherUserId, stationId: fx.otherStationId };
    expect(await editPendingOrderAction(forged as never)).toMatchObject({ ok: true });
    expect(vi.mocked(editPendingOrder).mock.calls[0][1]).toEqual({
      orderId: o.id,
      userId: fx.userId,
      sector: "mostrador",
      removeItemIds: [],
      addUnits: [unit(fx.melt)],
    });
    const [ev] = await testDb().select().from(s.orderEvents).where(eq(s.orderEvents.orderId, o.id));
    expect(ev).toBeDefined();
  });

  it.each([undefined, null, "x", {}, { orderId: 1 }, { orderId: -1, removeItemIds: [], addUnits: [] }])("malformed input %j -> VALIDATION", async (input) => {
    as("cajera");
    expect(await editPendingOrderAction(input as never)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(editPendingOrder).not.toHaveBeenCalled();
  });
});

describe("add-on actions", () => {
  it("addAddonAction with paused products returns the sold-out message and invalidates nothing", async () => {
    const p = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    const [item] = await testDb().insert(s.stockItems).values({ name: "Coca", kind: "bebida", unit: "u", minQty: 0 }).returning();
    const [cat] = await testDb().insert(s.categories).values({ name: "Bebidas", slug: "bebidas" }).returning();
    const [coke] = await testDb().insert(s.products).values({ categoryId: cat.id, name: "Coca-Cola", price: 2500_00, stockItemId: item.id }).returning();
    as("cajera");
    const r = await addAddonAction({ orderId: p.id, units: [unit(coke.id)], idempotencyKey: randomUUID() });
    expect(r).toMatchObject({ ok: false, code: "OUT_OF_STOCK", productIds: [coke.id], names: ["Coca-Cola"] });
    expect(r.ok === false && r.message).toMatch(/Coca-Cola/);
  });

  it("add, confirm and cancel flow through with the session user", async () => {
    const p = await preparingWebOrder(fx, { fulfillment: "takeaway", paymentMethod: "transfer" });
    as("cajera", fx.stationId, fx.userId);
    const forged = { orderId: p.id, units: [unit(fx.melt)], idempotencyKey: randomUUID(), userId: fx.otherUserId };
    const added = await addAddonAction(forged as never);
    expect(added).toMatchObject({ ok: true, data: { status: "pendiente_pago", seq: 1 } });
    expect(vi.mocked(addOrderAddon).mock.calls[0][1]).toMatchObject({ userId: fx.userId, sector: "mostrador" });
    const addonId = added.ok ? added.data.addonId : 0;
    expect(await confirmAddonAction({ addonId, paymentVerified: false })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await confirmAddonAction({ addonId, paymentVerified: true })).toMatchObject({ ok: true, data: { addonId, seq: 1 } });
    expect(await reprintAddonAction({ orderId: p.id, addonSeq: 1 })).toMatchObject({ ok: true });

    const second = await addAddonAction({ orderId: p.id, units: [unit(fx.melt)], idempotencyKey: randomUUID() });
    const id2 = second.ok ? second.data.addonId : 0;
    expect(await cancelAddonAction({ addonId: id2, reason: "se arrepintió" })).toMatchObject({ ok: true });
    expect((await orders(p.id))[0].status).toBe("en_preparacion");
  });

  it.each([undefined, {}, { addonId: "1", paymentVerified: true }, { addonId: 1 }])("confirmAddonAction malformed %j -> VALIDATION", async (input) => {
    as("cajera");
    expect(await confirmAddonAction(input as never)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(confirmAddon).not.toHaveBeenCalled();
  });
});
