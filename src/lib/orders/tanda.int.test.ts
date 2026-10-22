import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/orders/tanda", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/orders/tanda")>();
  return { ...m, setOrderTanda: vi.fn(m.setOrderTanda) };
});

import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession, type Role } from "@/lib/auth/roles";
import { setTandaAction } from "@/app/(staff)/despacho/actions";
import { assignCadet, markReady, returnToDispatch } from "./dispatch";
import { getDispatchBoard } from "./dispatch-queries";
import { setOrderTanda } from "./tanda";
import { makeCadet, orderEventsOf, orderRow, preparingCounterOrder, preparingWebOrder } from "@/test-support/dispatch";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";

const db = () => testDb();
let fx: Fx;

const setTanda = (orderId: number, tanda: number | null, sector: "delivery" | "mostrador" | null = null) =>
  setOrderTanda(db(), { orderId, userId: fx.userId, tanda, sector });
const readyDelivery = async () => {
  const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
  const r = await markReady(db(), { sector: null, orderId: o.id, userId: fx.userId });
  if (!r.ok) throw new Error(r.message);
  return o;
};
const tandaOf = async (id: number) => (await orderRow(id)).tanda;
const tandaEvents = async (id: number) => (await orderEventsOf(id)).filter((e) => e.note?.startsWith("Tanda"));

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("schema", () => {
  it("the column is nullable and the database refuses values outside 1..99", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
    expect(await tandaOf(o.id)).toBeNull();
    await expect(db().update(s.orders).set({ tanda: 0 }).where(eq(s.orders.id, o.id))).rejects.toThrow();
    await expect(db().update(s.orders).set({ tanda: 100 }).where(eq(s.orders.id, o.id))).rejects.toThrow();
  });
});

describe("setOrderTanda: set, change and clear", () => {
  for (const state of ["en_preparacion", "listo_despacho"] as const) {
    it(`sets, changes (event keeps the previous value) and clears in ${state}`, async () => {
      const o = state === "en_preparacion" ? await preparingWebOrder(fx, { fulfillment: "delivery" }) : await readyDelivery();
      expect(await setTanda(o.id, 1)).toEqual({ ok: true, data: { orderId: o.id, tanda: 1 } });
      expect(await tandaOf(o.id)).toBe(1);
      expect(await setTanda(o.id, 2)).toEqual({ ok: true, data: { orderId: o.id, tanda: 2 } });
      expect(await setTanda(o.id, null)).toEqual({ ok: true, data: { orderId: o.id, tanda: null } });
      expect(await tandaOf(o.id)).toBeNull();
      const evs = await tandaEvents(o.id);
      expect(evs.map((e) => e.note)).toEqual(["Tanda: 1", "Tanda: 2 (antes: 1)", "Tanda: ninguna (antes: 2)"]);
      for (const e of evs) expect(e).toMatchObject({ fromStatus: state, toStatus: state, userId: fx.userId });
      expect((await orderRow(o.id)).status).toBe(state);
    });
  }

  it("setting the same value is a no-op success without a new event", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
    await setTanda(o.id, 3);
    expect((await setTanda(o.id, 3)).ok).toBe(true);
    expect(await tandaEvents(o.id)).toHaveLength(1);
  });

  it("rejects an invalid number and a missing order", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
    expect(await setTanda(o.id, 0)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await setTanda(o.id, 100)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await setTanda(o.id, 1.5)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await setTanda(999_999, 1)).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await tandaOf(o.id)).toBeNull();
  });
});

describe("setOrderTanda: refusals", () => {
  it("refuses pendiente_aprobacion", async () => {
    const o = await placeWebOrder(fx, { fulfillment: "delivery" });
    expect(await setTanda(o.id, 1)).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await tandaOf(o.id)).toBeNull();
  });

  it.each(["en_camino", "entregado", "cancelado"] as const)("refuses %s", async (status) => {
    const o = await readyDelivery();
    await setTanda(o.id, 4);
    await db().update(s.orders).set({ status }).where(eq(s.orders.id, o.id));
    expect(await setTanda(o.id, 5)).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect(await tandaOf(o.id)).toBe(4);
  });

  it("refuses takeaway web orders and counter sales", async () => {
    const take = await preparingWebOrder(fx, { fulfillment: "takeaway" });
    const counter = await preparingCounterOrder(fx);
    expect(await setTanda(take.id, 1)).toMatchObject({ ok: false });
    expect(await setTanda(counter.id, 1)).toMatchObject({ ok: false });
    expect(await tandaOf(take.id)).toBeNull();
    expect(await tandaOf(counter.id)).toBeNull();
  });

  it("applies the sector rule: a mostrador actor cannot touch a delivery order", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
    expect(await setTanda(o.id, 1, "mostrador")).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await setTanda(o.id, 1, "delivery")).toMatchObject({ ok: true });
  });
});

describe("tanda survives status changes", () => {
  it("an order returning from en_camino to listo_despacho keeps its tanda", async () => {
    const o = await readyDelivery();
    await setTanda(o.id, 6);
    const cadet = await makeCadet("Nahuel");
    expect((await assignCadet(db(), { sector: null, orderIds: [o.id], cadetId: cadet.id, userId: fx.userId })).ok).toBe(true);
    expect(await setTanda(o.id, 7)).toMatchObject({ ok: false, code: "INVALID_STATE" });
    expect((await returnToDispatch(db(), { sector: null, orderId: o.id, userId: fx.userId, reason: "No estaba" })).ok).toBe(true);
    expect(await tandaOf(o.id)).toBe(6);
    expect(await setTanda(o.id, 7)).toMatchObject({ ok: true });
  });
});

describe("concurrency", () => {
  it("two concurrent changes end with one valid value and two events", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const [a, b] = await Promise.all([setTanda(o.id, 1), setTanda(o.id, 2)]);
    expect(a.ok && b.ok).toBe(true);
    const final = await tandaOf(o.id);
    expect([1, 2]).toContain(final);
    const evs = await tandaEvents(o.id);
    expect(evs).toHaveLength(2);
    expect(evs.some((e) => e.note?.includes("antes:"))).toBe(true);
  });
});

describe("realtime", () => {
  it("notifies the orders channel with event updated", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const { Client } = await import("pg");
    const { getEnv } = await import("@/lib/env");
    const { ORDERS_CHANNEL } = await import("@/lib/events/channels");
    const c = new Client({ connectionString: getEnv().DATABASE_URL });
    await c.connect();
    const got: string[] = [];
    c.on("notification", (m) => got.push(m.payload ?? ""));
    await c.query(`LISTEN ${ORDERS_CHANNEL}`);
    await setTanda(o.id, 1);
    for (let i = 0; i < 50 && !got.length; i++) await new Promise((r) => setTimeout(r, 50));
    await c.end();
    expect(got.map((p) => JSON.parse(p))).toContainEqual({ orderId: o.id, status: "en_preparacion", event: "updated" });
  });
});

describe("dispatch board", () => {
  it("exposes tanda on each order and the summary (only en_preparacion/listo_despacho)", async () => {
    const a = await preparingWebOrder(fx, { fulfillment: "delivery" });
    const b = await readyDelivery();
    const c = await readyDelivery();
    for (const o of [a, b, c]) await setTanda(o.id, 1);
    const cadet = await makeCadet("Nahuel");
    await assignCadet(db(), { sector: null, orderIds: [c.id], cadetId: cadet.id, userId: fx.userId });
    const board = await getDispatchBoard(db());
    expect(board.preparing.find((o) => o.id === a.id)?.tanda).toBe(1);
    expect(board.ready.delivery.find((o) => o.id === b.id)?.tanda).toBe(1);
    expect(board.enRoute[0].orders[0].tanda).toBe(1);
    expect(board.tandas).toEqual([{ tanda: 1, count: 2, overLimit: false }]);
  });
});

describe("setTandaAction", () => {
  const session = (role: Role, station: "mostrador" | "delivery" | null = null): AuthSession => ({
    user: { id: fx.userId, name: "U", username: "u", role },
    stationId: station === "mostrador" ? fx.stationId : station === "delivery" ? fx.otherStationId : null,
    stationKind: station,
    sessionId: "x",
  });
  const as = (role: Role, station: "mostrador" | "delivery" | null = null) =>
    vi.mocked(requireRole).mockImplementation(async (...allowed: Role[]) => {
      if (!allowed.includes(role)) throw new AuthError("FORBIDDEN");
      return session(role, station);
    });
  const form = (orderId: number, tanda: string) => {
    const fd = new FormData();
    fd.set("orderId", String(orderId));
    fd.set("tanda", tanda);
    return fd;
  };

  it.each(["cajera", "cocina"] as Role[])("refuses %s before touching the core", async (role) => {
    const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
    as(role, "mostrador");
    const r = await setTandaAction({}, form(o.id, "1"));
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(setOrderTanda).not.toHaveBeenCalled();
    expect(await tandaOf(o.id)).toBeNull();
  });

  it("accepts encargado, encargada_delivery (delivery station) and admin; empty clears", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
    as("encargado");
    expect(await setTandaAction({}, form(o.id, " 2 "))).toEqual({ ok: true, data: { orderId: o.id, tanda: 2 } });
    as("encargada_delivery", "delivery");
    expect(await setTandaAction({}, form(o.id, "3"))).toMatchObject({ ok: true });
    as("admin");
    expect(await setTandaAction({}, form(o.id, ""))).toEqual({ ok: true, data: { orderId: o.id, tanda: null } });
    expect(await tandaOf(o.id)).toBeNull();
  });

  it("returns clear validation errors without writing", async () => {
    const o = await preparingWebOrder(fx, { fulfillment: "delivery" });
    as("encargado");
    for (const bad of ["0", "abc", "100", "1.5"]) {
      const r = await setTandaAction({}, form(o.id, bad));
      expect(r).toMatchObject({ ok: false, code: "VALIDATION", message: "La tanda debe ser un número entero del 1 al 99." });
    }
    expect(await setTandaAction({}, form(-1, "1"))).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await tandaOf(o.id)).toBeNull();
  });

  it("a state failure comes back as a result, never thrown", async () => {
    const o = await placeWebOrder(fx, { fulfillment: "delivery" });
    as("encargado");
    expect(await setTandaAction({}, form(o.id, "1"))).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });
});
