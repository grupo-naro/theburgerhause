import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/settlements/settle-cadet", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/settlements/settle-cadet")>();
  return { ...m, settleCadet: vi.fn(m.settleCadet) };
});

import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession, type Role } from "@/lib/auth/roles";
import * as core from "@/lib/settlements/settle-cadet";
import { makeCadet, orderRow } from "@/test-support/dispatch";
import { redirectOf } from "@/test-support/next-mocks";
import { seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { deliveredOrder, sumTotals } from "@/test-support/settlements";
import { settleCadetAction } from "./actions";

let fx: Fx;
/** Staff sit at a station of their own kind (cashier: Mostrador, delivery manager: Delivery); admin needs none. */
const session = (role: Role, userId = fx.userId): AuthSession => ({
  user: { id: userId, name: "U", username: "u", role },
  stationId: role === "cajera" ? fx.stationId : role === "encargada_delivery" ? fx.otherStationId : null,
  stationKind: role === "cajera" ? "mostrador" : role === "encargada_delivery" ? "delivery" : null,
  sessionId: "x",
});
/** Mimics the real requireRole: the session is returned only when its role is allowed. */
const as = (role: Role, userId?: number) =>
  vi.mocked(requireRole).mockImplementation(async (...allowed: Role[]) => {
    if (!allowed.includes(role)) throw new AuthError("FORBIDDEN");
    return session(role, userId);
  });

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

async function debt() {
  const cadet = await makeCadet("Nahuel");
  const a = await deliveredOrder(fx, cadet.id);
  const b = await deliveredOrder(fx, cadet.id, { units: "two" });
  return { cadet, ids: [a.id, b.id], owed: await sumTotals([a.id, b.id]) };
}

describe("authorization", () => {
  it("anonymous is sent to /login and the core is not called", async () => {
    vi.mocked(requireRole).mockRejectedValue(new AuthError("UNAUTHENTICATED"));
    expect(await redirectOf(settleCadetAction({ cadetId: 1, expectedAmount: 100 }))).toBe("/login");
    expect(core.settleCadet).not.toHaveBeenCalled();
  });

  it("requires encargada_delivery or admin: the cajera is excluded", async () => {
    as("admin");
    await settleCadetAction({ cadetId: 1, expectedAmount: 100 });
    expect(vi.mocked(requireRole).mock.calls).toEqual([["encargada_delivery", "admin", "encargado"]]);
  });

  it("a cajera gets a generic error, the core is NOT called and nothing changes", async () => {
    const { cadet, ids, owed } = await debt();
    as("cajera");
    const r = await settleCadetAction({ cadetId: cadet.id, expectedAmount: owed });
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(!r.ok && r.message).toMatch(/permisos/);
    expect(core.settleCadet).not.toHaveBeenCalled();
    expect((await orderRow(ids[0])).paymentStatus).toBe("pending");
    expect(await testDb().select().from(s.settlements)).toHaveLength(0);
  });

  it.each(["encargada_delivery", "admin", "encargado"] as const)("%s can settle", async (role) => {
    const { cadet, ids, owed } = await debt();
    as(role);
    const r = await settleCadetAction({ cadetId: cadet.id, expectedAmount: owed, note: "ok" });
    expect(r).toMatchObject({ ok: true, data: { amount: owed, orderCount: 2, cadet: { name: "Nahuel" } } });
    for (const id of ids) expect((await orderRow(id)).paymentStatus).toBe("paid");
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

describe("session identity and payload hygiene", () => {
  it("takes userId from the session even if the client sends another; extra fields are stripped", async () => {
    const { cadet, owed } = await debt();
    as("encargada_delivery", fx.otherUserId);
    const forged = { cadetId: cadet.id, expectedAmount: owed, userId: fx.userId, settledBy: fx.userId, amount: 1, orders: [1] };
    expect(await settleCadetAction(forged as never)).toMatchObject({ ok: true });
    expect(vi.mocked(core.settleCadet).mock.calls[0][1]).toEqual({ cadetId: cadet.id, expectedAmount: owed, receivedAmount: owed, userId: fx.otherUserId });
    const [st] = await testDb().select().from(s.settlements);
    expect(st.settledBy).toBe(fx.otherUserId);
  });

  it.each([
    undefined,
    null,
    "x",
    [],
    {},
    { cadetId: 1 },
    { expectedAmount: 100 },
    { cadetId: "1", expectedAmount: 100 },
    { cadetId: 1, expectedAmount: "100" },
    { cadetId: 1, expectedAmount: 0 },
    { cadetId: 1, expectedAmount: -5 },
    { cadetId: 1, expectedAmount: 10.5 },
    { cadetId: 1, expectedAmount: 2_147_483_648 },
    { cadetId: 0, expectedAmount: 100 },
    { cadetId: 1, expectedAmount: 100, note: 5 },
    { cadetId: 1, expectedAmount: 100, note: "x".repeat(201) },
    { cadetId: 1, expectedAmount: 100, receivedAmount: 101, note: "sobra" },
    { cadetId: 1, expectedAmount: 100, receivedAmount: 50 },
    { cadetId: 1, expectedAmount: 100, receivedAmount: 0, note: "ab" },
    { cadetId: 1, expectedAmount: 100, receivedAmount: -1, note: "negativo" },
    { cadetId: 1, expectedAmount: 100, receivedAmount: 1.5, note: "decimal" },
  ])("malformed input %j -> VALIDATION without touching the core", async (input) => {
    as("admin");
    expect(await settleCadetAction(input as never)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(core.settleCadet).not.toHaveBeenCalled();
  });

  it("cleans the note (control characters stripped)", async () => {
    const { cadet, owed } = await debt();
    as("admin");
    await settleCadetAction({ cadetId: cadet.id, expectedAmount: owed, note: "  faltó\u0000 plata‮ " });
    expect((await testDb().select().from(s.settlements))[0].note).toBe("faltó plata");
  });
});

describe("received amount and shortage", () => {
  it("receivedAmount and the note pass through; the shortage is recorded and the debt cleared", async () => {
    const { cadet, ids, owed } = await debt();
    as("encargada_delivery");
    const r = await settleCadetAction({ cadetId: cadet.id, expectedAmount: owed, receivedAmount: owed - 2000_00, note: "Faltaron 2000", userId: 999, extra: 1 } as never);
    expect(r).toMatchObject({ ok: true, data: { amount: owed, receivedAmount: owed - 2000_00, shortage: 2000_00 } });
    expect(vi.mocked(core.settleCadet).mock.calls[0][1]).toEqual({ cadetId: cadet.id, expectedAmount: owed, receivedAmount: owed - 2000_00, note: "Faltaron 2000", userId: fx.userId });
    const [st] = await testDb().select().from(s.settlements);
    expect(st).toMatchObject({ receivedAmount: owed - 2000_00, note: "Faltaron 2000", settledBy: fx.userId });
    for (const id of ids) expect((await orderRow(id)).paymentStatus).toBe("paid");
  });

  it("a shortage without a note is a VALIDATION result and nothing is written", async () => {
    const { cadet, ids, owed } = await debt();
    as("admin");
    expect(await settleCadetAction({ cadetId: cadet.id, expectedAmount: owed, receivedAmount: owed - 1 })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(core.settleCadet).not.toHaveBeenCalled();
    expect((await orderRow(ids[0])).paymentStatus).toBe("pending");
  });

  it("a cajera cannot settle with a shortage either", async () => {
    const { cadet, owed } = await debt();
    as("cajera");
    expect(await settleCadetAction({ cadetId: cadet.id, expectedAmount: owed, receivedAmount: 0, note: "nada" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(core.settleCadet).not.toHaveBeenCalled();
  });
});

describe("expected failures are returned, not thrown", () => {
  it("AMOUNT_MISMATCH carries the real figures; NOTHING_TO_SETTLE and CADET_NOT_FOUND are results", async () => {
    const { cadet, ids, owed } = await debt();
    as("encargada_delivery");
    const mismatch = await settleCadetAction({ cadetId: cadet.id, expectedAmount: owed + 100 });
    expect(mismatch).toMatchObject({ ok: false, code: "AMOUNT_MISMATCH", details: { expected: owed + 100, actual: owed, orderCount: 2 } });
    for (const id of ids) expect((await orderRow(id)).paymentStatus).toBe("pending");

    expect(await settleCadetAction({ cadetId: cadet.id, expectedAmount: owed })).toMatchObject({ ok: true });
    expect(await settleCadetAction({ cadetId: cadet.id, expectedAmount: owed })).toMatchObject({ ok: false, code: "NOTHING_TO_SETTLE" });
    expect(await settleCadetAction({ cadetId: 99999, expectedAmount: owed })).toMatchObject({ ok: false, code: "CADET_NOT_FOUND" });
    expect(await testDb().select().from(s.settlements).where(eq(s.settlements.cadetId, cadet.id))).toHaveLength(1);
  });
});

describe("unexpected errors", () => {
  it("a throwing core becomes a fixed generic message and leaks nothing", async () => {
    as("admin");
    const secret = 'duplicate key value violates "settlements_pkey" at SELECT * FROM settlements';
    vi.mocked(core.settleCadet).mockRejectedValueOnce(Object.assign(new Error(secret), { code: "23505" }));
    const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "log"), vi.spyOn(console, "warn")].map((spy) => spy.mockImplementation(() => {}));
    const r = await settleCadetAction({ cadetId: 1, expectedAmount: 100 });
    expect(r).toEqual({ ok: false, code: "UNEXPECTED", message: "No se pudo completar la acción. Probá de nuevo." });
    const logged = JSON.stringify(logs.map((l) => l.mock.calls));
    expect(logged).not.toContain("settlements_pkey");
    expect(logged).not.toContain("SELECT");
    expect(logged).toContain("23505");
  });

  it("an UNEXPECTED result from the core passes through with its generic message", async () => {
    as("admin");
    vi.mocked(core.settleCadet).mockResolvedValueOnce({ ok: false, code: "UNEXPECTED", message: "No se pudo completar la acción. Probá de nuevo." });
    expect(await settleCadetAction({ cadetId: 1, expectedAmount: 100 })).toEqual({
      ok: false,
      code: "UNEXPECTED",
      message: "No se pudo completar la acción. Probá de nuevo.",
    });
  });
});

describe("module shape", () => {
  it("exports only async functions at runtime", async () => {
    const mod = await import("./actions");
    for (const [name, value] of Object.entries(mod)) {
      expect(typeof value, name).toBe("function");
      expect(value.constructor.name, name).toBe("AsyncFunction");
    }
    expect(Object.keys(mod)).toEqual(["settleCadetAction"]);
  });
});

describe("sector rule (server side)", () => {
  it("an encargada sitting at a Mostrador station gets WRONG_SECTOR and nothing is settled", async () => {
    const { cadet, ids, owed } = await debt();
    vi.mocked(requireRole).mockImplementation(async () => ({
      user: { id: fx.userId, name: "U", username: "u", role: "encargada_delivery" },
      stationId: fx.stationId,
      stationKind: "mostrador",
      sessionId: "x",
    }));
    const r = await settleCadetAction({ cadetId: cadet.id, expectedAmount: owed });
    expect(r).toMatchObject({ ok: false, code: "WRONG_SECTOR" });
    expect(core.settleCadet).not.toHaveBeenCalled();
    expect((await orderRow(ids[0])).paymentStatus).toBe("pending");
    expect(await testDb().select().from(s.settlements)).toHaveLength(0);
  });

  it("an encargada without a station is refused (STATION_REQUIRED) before the core", async () => {
    const { cadet, owed } = await debt();
    vi.mocked(requireRole).mockImplementation(async () => ({
      user: { id: fx.userId, name: "U", username: "u", role: "encargada_delivery" },
      stationId: null,
      stationKind: null,
      sessionId: "x",
    }));
    expect(await settleCadetAction({ cadetId: cadet.id, expectedAmount: owed })).toMatchObject({ ok: false, code: "STATION_REQUIRED" });
    expect(core.settleCadet).not.toHaveBeenCalled();
  });

  it("admin is exempt even on a Mostrador station", async () => {
    const { cadet, owed } = await debt();
    vi.mocked(requireRole).mockImplementation(async () => ({
      user: { id: fx.userId, name: "U", username: "u", role: "admin" },
      stationId: fx.stationId,
      stationKind: "mostrador",
      sessionId: "x",
    }));
    expect(await settleCadetAction({ cadetId: cadet.id, expectedAmount: owed })).toMatchObject({ ok: true });
  });
});
