import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/orders/assign-tanda", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/orders/assign-tanda")>();
  return { ...m, assignTanda: vi.fn(m.assignTanda) };
});

import { eq, inArray } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession, type Role } from "@/lib/auth/roles";
import { assignTandaAction } from "@/app/(staff)/despacho/actions";
import { makeCadet, orderRow, preparingCounterOrder, preparingWebOrder } from "@/test-support/dispatch";
import { seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { assignTanda } from "./assign-tanda";
import { assignCadet, markReady } from "./dispatch";
import { setOrderTanda } from "./tanda";

const db = () => testDb();
let fx: Fx;

const ready = async (tanda: number | null = 1) => {
  const o = await preparingWebOrder(fx, { fulfillment: "delivery", paymentMethod: "cash" });
  const r = await markReady(db(), { sector: null, orderId: o.id, userId: fx.userId });
  if (!r.ok) throw new Error(r.message);
  if (tanda !== null) await setOrderTanda(db(), { orderId: o.id, userId: fx.userId, tanda, sector: null });
  return o;
};
const preparing = async (tanda: number) => {
  const o = await preparingWebOrder(fx, { fulfillment: "delivery", paymentMethod: "cash" });
  await setOrderTanda(db(), { orderId: o.id, userId: fx.userId, tanda, sector: null });
  return o;
};
const tandaAssign = (over: { orderIds: number[]; cadetId: number; tanda?: number; confirmPartial?: boolean; sector?: "delivery" | "mostrador" | null }) =>
  assignTanda(db(), { tanda: over.tanda ?? 1, orderIds: over.orderIds, cadetId: over.cadetId, userId: fx.userId, confirmPartial: over.confirmPartial ?? false, sector: over.sector ?? null });
const snapshot = async (ids: number[]) => {
  const rows = await db().select().from(s.orders).where(inArray(s.orders.id, ids)).orderBy(s.orders.id);
  const evs = await db().select().from(s.orderEvents).where(inArray(s.orderEvents.orderId, ids)).orderBy(s.orderEvents.id);
  return JSON.stringify({ rows, evs });
};

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("assignTanda: success", () => {
  it("a tanda with its 3 orders ready goes out with the cadet in one go", async () => {
    const [a, b, c] = [await ready(), await ready(), await ready()];
    const other = await ready(2);
    const cadet = await makeCadet("Nahuel");
    const r = await tandaAssign({ orderIds: [c.id, a.id, b.id], cadetId: cadet.id });
    expect(r).toMatchObject({ ok: true, data: { assigned: [a.id, b.id, c.id], pending: [], cadet: { id: cadet.id, name: "Nahuel" } } });
    if (!r.ok) return;
    const cash = (await orderRow(a.id)).total + (await orderRow(b.id)).total + (await orderRow(c.id)).total;
    expect(r.data.cashToCollect).toBe(cash);
    for (const o of [a, b, c]) expect(await orderRow(o.id)).toMatchObject({ status: "en_camino", cadetId: cadet.id, tanda: 1 });
    expect(await orderRow(other.id)).toMatchObject({ status: "listo_despacho", cadetId: null, tanda: 2 });
  });

  it("orders of the same number already en camino (an earlier trip) do not count", async () => {
    const old = await ready();
    const cadet = await makeCadet("Nahuel");
    expect((await assignCadet(db(), { sector: null, orderIds: [old.id], cadetId: cadet.id, userId: fx.userId })).ok).toBe(true);
    const a = await ready();
    expect(await tandaAssign({ orderIds: [a.id], cadetId: cadet.id })).toMatchObject({ ok: true, data: { assigned: [a.id], pending: [] } });
  });
});

describe("assignTanda: incomplete tanda", () => {
  it("2 ready + 1 in preparation without confirmation -> TANDA_INCOMPLETE {ready:2,total:3} and nothing changes", async () => {
    const [a, b] = [await ready(), await ready()];
    const c = await preparing(1);
    const cadet = await makeCadet();
    const before = await snapshot([a.id, b.id, c.id]);
    const r = await tandaAssign({ orderIds: [a.id, b.id], cadetId: cadet.id });
    expect(r).toMatchObject({ ok: false, code: "TANDA_INCOMPLETE", ready: 2, total: 3 });
    if (!r.ok) expect(r.message).toContain("2 de 3");
    expect(await snapshot([a.id, b.id, c.id])).toBe(before);
  });

  it("with confirmPartial the 2 ready go out and the third keeps its tanda and its state", async () => {
    const [a, b] = [await ready(), await ready()];
    const c = await preparing(1);
    const cadet = await makeCadet();
    const r = await tandaAssign({ orderIds: [a.id, b.id], cadetId: cadet.id, confirmPartial: true });
    expect(r).toMatchObject({ ok: true, data: { assigned: [a.id, b.id], pending: [c.id] } });
    for (const o of [a, b]) expect((await orderRow(o.id)).status).toBe("en_camino");
    expect(await orderRow(c.id)).toMatchObject({ status: "en_preparacion", tanda: 1, cadetId: null });
  });
});

describe("assignTanda: the tanda changed between the selection and the submit -> CHANGED, nothing assigned", () => {
  it("a listed order moved to another tanda", async () => {
    const [a, b] = [await ready(), await ready()];
    await setOrderTanda(db(), { orderId: b.id, userId: fx.userId, tanda: 2, sector: null });
    const cadet = await makeCadet();
    const before = await snapshot([a.id, b.id]);
    const r = await tandaAssign({ orderIds: [a.id, b.id], cadetId: cadet.id, confirmPartial: true });
    expect(r).toMatchObject({ ok: false, code: "CHANGED", details: [{ orderId: b.id, orderNumber: b.number }] });
    expect(await snapshot([a.id, b.id])).toBe(before);
  });

  it("a listed order lost its tanda", async () => {
    const [a, b] = [await ready(), await ready()];
    await setOrderTanda(db(), { orderId: a.id, userId: fx.userId, tanda: null, sector: null });
    const cadet = await makeCadet();
    expect(await tandaAssign({ orderIds: [a.id, b.id], cadetId: cadet.id })).toMatchObject({ ok: false, code: "CHANGED" });
    expect((await orderRow(b.id)).status).toBe("listo_despacho");
  });

  it("a listed order is no longer ready (went out with someone else / cancelled)", async () => {
    const [a, b, c] = [await ready(), await ready(), await ready()];
    const first = await makeCadet("Primero");
    expect((await assignCadet(db(), { sector: null, orderIds: [b.id], cadetId: first.id, userId: fx.userId })).ok).toBe(true);
    await db().update(s.orders).set({ status: "cancelado" }).where(eq(s.orders.id, c.id));
    const cadet = await makeCadet("Segundo");
    const r = await tandaAssign({ orderIds: [a.id, b.id, c.id], cadetId: cadet.id, confirmPartial: true });
    expect(r).toMatchObject({ ok: false, code: "CHANGED" });
    if (!r.ok && "details" in r) expect(r.details?.map((d) => d.orderId).sort()).toEqual([b.id, c.id].sort());
    expect(await orderRow(a.id)).toMatchObject({ status: "listo_despacho", cadetId: null });
    expect(await orderRow(b.id)).toMatchObject({ cadetId: first.id });
  });

  it("another order of the tanda became ready and is not in the list (the selection is stale)", async () => {
    const a = await ready();
    const b = await ready();
    const cadet = await makeCadet();
    expect(await tandaAssign({ orderIds: [a.id], cadetId: cadet.id, confirmPartial: true })).toMatchObject({ ok: false, code: "CHANGED" });
    expect((await orderRow(a.id)).status).toBe("listo_despacho");
    expect((await orderRow(b.id)).status).toBe("listo_despacho");
  });

  it("two people sending the same tanda at once: one wins, the other gets CHANGED", async () => {
    const [a, b] = [await ready(), await ready()];
    const [x, y] = [await makeCadet("Uno"), await makeCadet("Dos")];
    const results = await Promise.all([tandaAssign({ orderIds: [a.id, b.id], cadetId: x.id }), tandaAssign({ orderIds: [a.id, b.id], cadetId: y.id })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, code: "CHANGED" });
    const cadets = new Set([(await orderRow(a.id)).cadetId, (await orderRow(b.id)).cadetId]);
    expect(cadets.size).toBe(1);
  });
});

describe("assignTanda: refusals delegated to the cadet assignment", () => {
  it("a counter order in the list is refused and nothing is assigned", async () => {
    const a = await ready();
    const counter = await preparingCounterOrder(fx);
    await markReady(db(), { sector: null, orderId: counter.id, userId: fx.userId });
    const cadet = await makeCadet();
    const r = await tandaAssign({ orderIds: [a.id, counter.id], cadetId: cadet.id, confirmPartial: true });
    expect(r).toMatchObject({ ok: false, code: "NOT_DELIVERY" });
    expect((await orderRow(a.id)).status).toBe("listo_despacho");
  });

  it("an inactive cadet -> CADET_INACTIVE, nothing assigned", async () => {
    const a = await ready();
    const cadet = await makeCadet("Inactivo", { active: false });
    expect(await tandaAssign({ orderIds: [a.id], cadetId: cadet.id })).toMatchObject({ ok: false, code: "CADET_INACTIVE" });
    expect((await orderRow(a.id)).status).toBe("listo_despacho");
  });

  it("a mostrador actor -> WRONG_SECTOR", async () => {
    const a = await ready();
    const cadet = await makeCadet();
    expect(await tandaAssign({ orderIds: [a.id], cadetId: cadet.id, sector: "mostrador" })).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(await tandaAssign({ orderIds: [a.id], cadetId: cadet.id, sector: "delivery" })).toMatchObject({ ok: true });
  });

  it("invalid input -> VALIDATION", async () => {
    const cadet = await makeCadet();
    const a = await ready();
    for (const tanda of [0, 100, 1.5]) expect(await tandaAssign({ orderIds: [a.id], cadetId: cadet.id, tanda })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await tandaAssign({ orderIds: [], cadetId: cadet.id })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect((await orderRow(a.id)).status).toBe("listo_despacho");
  });
});

describe("assignTandaAction", () => {
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
  const form = (fields: { tanda: string; orderIds: number[]; cadetId: number | string; confirmPartial?: string }) => {
    const fd = new FormData();
    fd.set("tanda", fields.tanda);
    for (const id of fields.orderIds) fd.append("orderId", String(id));
    fd.set("cadetId", String(fields.cadetId));
    if (fields.confirmPartial !== undefined) fd.set("confirmPartial", fields.confirmPartial);
    return fd;
  };

  it.each(["cajera", "cocina"] as Role[])("refuses %s before touching the core", async (role) => {
    const a = await ready();
    const cadet = await makeCadet();
    as(role, "mostrador");
    expect(await assignTandaAction(null, form({ tanda: "1", orderIds: [a.id], cadetId: cadet.id }))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(assignTanda).not.toHaveBeenCalled();
    expect((await orderRow(a.id)).status).toBe("listo_despacho");
  });

  it("encargada_delivery at her station assigns; the user comes from the session and the result is serializable", async () => {
    const [a, b] = [await ready(), await ready()];
    const cadet = await makeCadet("Nahuel");
    as("encargada_delivery", "delivery");
    const r = await assignTandaAction(null, form({ tanda: "1", orderIds: [a.id, b.id], cadetId: cadet.id }));
    expect(r).toMatchObject({ ok: true, data: { assigned: [a.id, b.id], pending: [] } });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(vi.mocked(assignTanda).mock.calls[0][1]).toEqual({ tanda: 1, orderIds: [a.id, b.id], cadetId: cadet.id, userId: fx.userId, confirmPartial: false, sector: "delivery" });
  });

  it("encargado and admin are accepted; TANDA_INCOMPLETE comes back with ready/total, then confirmPartial=1 assigns", async () => {
    const a = await ready();
    const c = await preparing(1);
    const cadet = await makeCadet();
    as("encargado");
    expect(await assignTandaAction(null, form({ tanda: "1", orderIds: [a.id], cadetId: cadet.id }))).toMatchObject({ ok: false, code: "TANDA_INCOMPLETE", ready: 1, total: 2 });
    as("admin");
    expect(await assignTandaAction(null, form({ tanda: "1", orderIds: [a.id], cadetId: cadet.id, confirmPartial: "1" }))).toMatchObject({ ok: true, data: { assigned: [a.id], pending: [c.id] } });
  });

  it("malformed forms -> VALIDATION without the core", async () => {
    as("admin");
    for (const bad of [
      form({ tanda: "abc", orderIds: [1], cadetId: 1 }),
      form({ tanda: "", orderIds: [1], cadetId: 1 }),
      form({ tanda: "1", orderIds: [], cadetId: 1 }),
      form({ tanda: "1", orderIds: [1], cadetId: "x" }),
      form({ tanda: "1", orderIds: [-1], cadetId: 1 }),
      form({ tanda: "1", orderIds: [1], cadetId: 1, confirmPartial: "maybe" }),
    ]) {
      expect(await assignTandaAction(null, bad)).toMatchObject({ ok: false, code: "VALIDATION" });
    }
    expect(assignTanda).not.toHaveBeenCalled();
  });
});
