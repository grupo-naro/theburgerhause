import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/orders/create-counter-order", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/orders/create-counter-order")>();
  return { ...m, createCounterOrder: vi.fn(m.createCounterOrder) };
});
vi.mock("@/lib/menu/cache", () => ({ invalidateMenu: vi.fn(), MENU_CACHE_TAG: "menu" }));
vi.mock("@/lib/orders/print-state", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/orders/print-state")>();
  return { ...m, getOrderPrintState: vi.fn(m.getOrderPrintState) };
});
vi.mock("@/lib/orders/pagers", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/orders/pagers")>();
  return { ...m, listActivePagers: vi.fn(m.listActivePagers) };
});

import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession, type Role } from "@/lib/auth/roles";
import { invalidateMenu } from "@/lib/menu/cache";
import { createCounterOrder } from "@/lib/orders/create-counter-order";
import { setInitialStock } from "@/lib/stock/movements";
import { listActivePagers } from "@/lib/orders/pagers";
import { getOrderPrintState } from "@/lib/orders/print-state";
import { redirectOf } from "@/test-support/next-mocks";
import { seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { createCounterOrderAction, getPrintStateAction, listActivePagersAction } from "./actions";

let fx: Fx;
const session = (role: Role, stationId: number | null, userId = fx.userId): AuthSession => ({
  user: { id: userId, name: "U", username: "u", role },
  stationId,
  stationKind: stationId === fx.stationId ? "mostrador" : stationId === fx.otherStationId ? "delivery" : null,
  sessionId: "x",
});
const as = (role: Role, stationId: number | null = fx.stationId, userId?: number) =>
  vi.mocked(requireRole).mockResolvedValue(session(role, stationId, userId));
const body = (over: Record<string, unknown> = {}) => ({
  idempotencyKey: crypto.randomUUID(),
  units: [{ productId: fx.ranchita, modifierIds: [fx.dips], note: "" }],
  paymentMethod: "cash",
  pagerNumber: 7,
  ...over,
});
const orders = () => testDb().select().from(s.orders);
const jobs = () => testDb().select().from(s.printJobs);
const GENERIC = "No se pudo completar la acción. Probá de nuevo.";

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("authorization", () => {
  const calls: [string, () => Promise<unknown>][] = [
    ["createCounterOrderAction", () => createCounterOrderAction(body())],
    ["listActivePagersAction", () => listActivePagersAction()],
    ["getPrintStateAction", () => getPrintStateAction({ orderId: 1 })],
  ];

  it.each(calls)("%s: anonymous is sent to /login and the core is not called", async (_n, run) => {
    vi.mocked(requireRole).mockRejectedValue(new AuthError("UNAUTHENTICATED"));
    expect(await redirectOf(run())).toBe("/login");
    expect(createCounterOrder).not.toHaveBeenCalled();
    expect(await orders()).toHaveLength(0);
  });

  it.each(calls)("%s: a role outside the allowed set (encargada_delivery) gets a generic error", async (_n, run) => {
    vi.mocked(requireRole).mockRejectedValue(new AuthError("FORBIDDEN"));
    const r = (await run()) as { ok: boolean; code: string; message: string };
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(r.message).toMatch(/permisos/);
    expect(createCounterOrder).not.toHaveBeenCalled();
    expect(await orders()).toHaveLength(0);
  });

  it("requires exactly cajera, admin and encargado (not encargada_delivery), before anything else", async () => {
    as("cajera");
    await createCounterOrderAction(body());
    await listActivePagersAction();
    expect(vi.mocked(requireRole).mock.calls).toEqual([
      ["cajera", "admin", "encargado"],
      ["cajera", "admin", "encargado"],
    ]);
  });

  it.each(["cajera", "admin", "encargado"] as const)("%s can sell at the counter", async (role) => {
    as(role);
    expect(await createCounterOrderAction(body())).toMatchObject({ ok: true });
  });
});

describe("createCounterOrderAction", () => {
  it("takes userId and stationId from the session, ignoring client-sent ones (and other forged fields)", async () => {
    as("cajera", fx.stationId, fx.userId);
    const input = body({ userId: fx.otherUserId, stationId: fx.otherStationId, total: 1, status: "entregado", channel: "web" });
    const r = await createCounterOrderAction(input as never);
    expect(r).toMatchObject({ ok: true, data: { pagerNumber: 7, paymentMethod: "cash", duplicate: false } });
    const arg = vi.mocked(createCounterOrder).mock.calls[0][1] as Record<string, unknown>;
    expect(arg).toMatchObject({ userId: fx.userId, stationId: fx.stationId });
    expect(Object.keys(arg).sort()).toEqual(["idempotencyKey", "pagerNumber", "paymentMethod", "stationId", "units", "userId"]);
    const [o] = await orders();
    expect(o).toMatchObject({
      approvedBy: fx.userId,
      stationId: fx.stationId,
      status: "en_preparacion",
      paymentStatus: "paid",
      channel: "counter",
    });
    expect((await jobs()).every((j) => j.stationId === fx.stationId)).toBe(true);
  });

  it("sector rule: a cashier at a Delivery station is refused (WRONG_SECTOR) before anything is written; admin is exempt", async () => {
    as("cajera", fx.otherStationId);
    expect(await createCounterOrderAction(body())).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(createCounterOrder).not.toHaveBeenCalled();
    expect(await orders()).toHaveLength(0);
    as("admin", fx.otherStationId);
    expect(await createCounterOrderAction(body())).toMatchObject({ ok: true });
  });

  it("returns serializable data", async () => {
    as("admin");
    const r = await createCounterOrderAction(body());
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("session without station -> STATION_REQUIRED result, not thrown", async () => {
    as("cajera", null);
    expect(await createCounterOrderAction(body())).toEqual({
      ok: false,
      code: "STATION_REQUIRED",
      message: "Elegí tu estación para imprimir",
    });
    expect(await orders()).toHaveLength(0);
  });

  it("expected failures are returned: PAGER_IN_USE, UNITS_INVALID, VALIDATION (with fieldErrors)", async () => {
    as("cajera");
    await createCounterOrderAction(body());
    expect(await createCounterOrderAction(body())).toMatchObject({ ok: false, code: "PAGER_IN_USE" });
    expect(
      await createCounterOrderAction(body({ pagerNumber: 8, units: [{ productId: 424242, modifierIds: [], note: "" }] })),
    ).toMatchObject({ ok: false, code: "UNITS_INVALID", unitIssues: [{ unitIndex: 0, code: "PRODUCT_UNAVAILABLE" }] });
    const bad = await createCounterOrderAction(body({ pagerNumber: 1000 }));
    expect(bad).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { pagerNumber: expect.any(String) } });
    expect(await orders()).toHaveLength(1);
  });

  it.each([undefined, null, "x", {}, [], 5])("malformed input %j -> VALIDATION without touching the core", async (input) => {
    as("cajera");
    expect(await createCounterOrderAction(input as never)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(createCounterOrder).not.toHaveBeenCalled();
  });

  it("a retry with the same key answers duplicate: true", async () => {
    as("cajera");
    const input = body();
    await createCounterOrderAction(input);
    expect(await createCounterOrderAction(input)).toMatchObject({ ok: true, data: { duplicate: true } });
    expect(await orders()).toHaveLength(1);
  });

  it("a throwing core becomes a fixed generic message and leaks nothing", async () => {
    as("cajera");
    const secret = "duplicate key value violates orders_pkey at SELECT * FROM orders";
    vi.mocked(createCounterOrder).mockRejectedValueOnce(Object.assign(new Error(secret), { code: "23505" }));
    const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "log"), vi.spyOn(console, "warn")].map((spy) =>
      spy.mockImplementation(() => {}),
    );
    const r = await createCounterOrderAction(body());
    expect(r).toEqual({ ok: false, code: "UNEXPECTED", message: GENERIC });
    const logged = JSON.stringify(logs.map((l) => l.mock.calls));
    expect(logged).not.toContain("orders_pkey");
    expect(logged).not.toContain("SELECT");
    expect(logged).toContain("23505");
  });
});

describe("listActivePagersAction", () => {
  it("returns the active pagers for the keypad", async () => {
    as("cajera");
    await createCounterOrderAction(body({ pagerNumber: 12 }));
    await createCounterOrderAction(body({ pagerNumber: 3 }));
    const r = await listActivePagersAction();
    expect(r).toMatchObject({ ok: true, data: [{ pagerNumber: 3, status: "en_preparacion" }, { pagerNumber: 12 }] });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("a throwing query becomes the generic message and logs only the pg code", async () => {
    as("cajera");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(listActivePagers).mockRejectedValueOnce(Object.assign(new Error("secret SELECT"), { code: "XX000" }));
    expect(await listActivePagersAction()).toEqual({ ok: false, code: "UNEXPECTED", message: GENERIC });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(log.mock.calls)).toContain("XX000");
  });
});

describe("getPrintStateAction", () => {
  const sell = async (over: Record<string, unknown> = {}) => {
    const r = await createCounterOrderAction(body(over));
    if (!r.ok) throw new Error("sale failed");
    return r.data;
  };

  it("requires exactly cajera and admin", async () => {
    as("cajera");
    const a = await sell();
    vi.mocked(requireRole).mockClear();
    await getPrintStateAction({ orderId: a.orderId });
    expect(vi.mocked(requireRole).mock.calls).toEqual([["cajera", "admin", "encargado"]]);
  });

  it("returns the job counts of THAT order; other orders are unaffected", async () => {
    as("cajera");
    const a = await sell({ pagerNumber: 1 });
    const b = await sell({ pagerNumber: 2 });
    expect(await getPrintStateAction({ orderId: a.orderId })).toEqual({ ok: true, data: { pending: 1, failed: 0, done: 0 } });
    await testDb().update(s.printJobs).set({ status: "done" }).where(eq(s.printJobs.orderId, a.orderId));
    expect(await getPrintStateAction({ orderId: a.orderId })).toEqual({ ok: true, data: { pending: 0, failed: 0, done: 1 } });
    expect(await getPrintStateAction({ orderId: b.orderId })).toEqual({ ok: true, data: { pending: 1, failed: 0, done: 0 } });
  });

  it("counts printing as pending and an unhandled failure as failed", async () => {
    as("cajera");
    const a = await sell();
    expect(a.printJobIds).toHaveLength(1); // a counter sale prints ONE ticket: the customer one
    const [customer] = a.printJobIds;
    await testDb().insert(s.printJobs).values({ orderId: a.orderId, stationId: fx.stationId, type: "delivery", status: "printing", payload: {} } as never);
    await testDb().update(s.printJobs).set({ status: "failed", attempts: 3 }).where(eq(s.printJobs.id, customer));
    expect(await getPrintStateAction({ orderId: a.orderId })).toEqual({ ok: true, data: { pending: 1, failed: 1, done: 0 } });
  });

  it("a failure superseded by a later job (reprint) no longer counts", async () => {
    as("cajera");
    const a = await sell();
    const [customer] = a.printJobIds;
    await testDb().update(s.printJobs).set({ status: "failed", attempts: 3 }).where(eq(s.printJobs.id, customer));
    await testDb().insert(s.printJobs).values({ orderId: a.orderId, stationId: fx.stationId, type: "customer", status: "pending", payload: {} } as never);
    expect(await getPrintStateAction({ orderId: a.orderId })).toMatchObject({ ok: true, data: { failed: 0 } });
  });

  it("unknown id -> generic not-found result (no detail leaked); bad input -> VALIDATION", async () => {
    as("cajera");
    expect(await getPrintStateAction({ orderId: 999_999 })).toEqual({ ok: false, code: "NOT_FOUND", message: "El pedido no existe" });
    expect(await getPrintStateAction({ orderId: "1" })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await getPrintStateAction(null)).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("a throwing query becomes the generic message", async () => {
    as("cajera");
    const a = await sell();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getOrderPrintState).mockRejectedValueOnce(Object.assign(new Error("secret SELECT"), { code: "XX000" }));
    expect(await getPrintStateAction({ orderId: a.orderId })).toEqual({ ok: false, code: "UNEXPECTED", message: GENERIC });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });
});

describe("drink stock", () => {
  async function linkDrink(units: number) {
    const [item] = await testDb().insert(s.stockItems).values({ name: "Coca 500", kind: "bebida", unit: "u", minQty: 0 }).returning();
    await testDb().update(s.products).set({ stockItemId: item.id }).where(eq(s.products.id, fx.melt));
    const r = await setInitialStock(testDb(), { itemId: item.id, userId: fx.userId, milli: units * 1000 });
    if (!r.ok) throw new Error(r.message);
    return item.id;
  }
  const drink = () => body({ units: [{ productId: fx.melt, modifierIds: [], note: "" }] });

  it("OUT_OF_STOCK is returned with the products to disable; nothing is sold", async () => {
    as("cajera");
    await linkDrink(0);
    expect(await createCounterOrderAction(drink())).toEqual({
      ok: false,
      code: "OUT_OF_STOCK",
      message: "Se agotó Melt simple. Sacala del pedido para continuar.",
      productIds: [fx.melt],
      names: ["Melt simple"],
    });
    expect(await orders()).toHaveLength(0);
    expect(await jobs()).toHaveLength(0);
    expect(invalidateMenu).not.toHaveBeenCalled();
  });

  it("selling the last unit refreshes the cached menu", async () => {
    as("cajera");
    const itemId = await linkDrink(1);
    expect(await createCounterOrderAction(drink())).toMatchObject({ ok: true });
    expect(invalidateMenu).toHaveBeenCalledTimes(1);
    const [row] = await testDb().select({ q: s.stockItems.quantity }).from(s.stockItems).where(eq(s.stockItems.id, itemId));
    expect(row.q).toBe(0);
  });
});

describe("module shape", () => {
  it("exports only async functions at runtime", async () => {
    const mod = await import("./actions");
    for (const [name, value] of Object.entries(mod)) {
      expect(typeof value, name).toBe("function");
      expect(value.constructor.name, name).toBe("AsyncFunction");
    }
    expect(Object.keys(mod).sort()).toEqual(["createCounterOrderAction", "getPrintStateAction", "listActivePagersAction"]);
  });
});
