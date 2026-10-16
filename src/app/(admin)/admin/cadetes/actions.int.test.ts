import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/cadets/cache", () => ({ invalidateCadets: vi.fn() }));
vi.mock("@/lib/cadets/admin", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/cadets/admin")>();
  return { ...m, saveCadet: vi.fn(m.saveCadet), setCadetActive: vi.fn(m.setCadetActive) };
});

import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession } from "@/lib/auth/roles";
import * as core from "@/lib/cadets/admin";
import { invalidateCadets } from "@/lib/cadets/cache";
import { form, redirectOf } from "@/test-support/next-mocks";
import { saveCadetAction, toggleCadetActiveAction } from "./actions";

const session = (role: "admin" | "cajera"): AuthSession => ({
  user: { id: 1, name: "U", username: "u", role },
  stationId: null,
  stationKind: null,
  sessionId: "x",
});
const asAdmin = () => vi.mocked(requireRole).mockResolvedValue(session("admin"));
const asCajera = () => vi.mocked(requireRole).mockRejectedValue(new AuthError("FORBIDDEN"));
const anonymous = () => vi.mocked(requireRole).mockRejectedValue(new AuthError("UNAUTHENTICATED"));
const prev = {};

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});
afterAll(closeDb);

describe("authorization", () => {
  const calls: [string, () => Promise<unknown>, () => unknown][] = [
    ["saveCadetAction", () => saveCadetAction(prev, form({ name: "X" })), () => core.saveCadet],
    [
      "toggleCadetActiveAction",
      () => toggleCadetActiveAction(prev, form({ id: "1", value: "false" })),
      () => core.setCadetActive,
    ],
  ];
  it.each(calls)("%s: cajera gets an error and the core is never called", async (_n, run, spy) => {
    asCajera();
    expect(((await run()) as { error?: string }).error).toBeTruthy();
    expect(spy()).not.toHaveBeenCalled();
    expect(invalidateCadets).not.toHaveBeenCalled();
    expect(await testDb().select().from(s.cadets)).toHaveLength(0);
  });
  it.each(calls)("%s: anonymous is sent to /login", async (_n, run, spy) => {
    anonymous();
    expect(await redirectOf(run())).toBe("/login");
    expect(spy()).not.toHaveBeenCalled();
    expect(invalidateCadets).not.toHaveBeenCalled();
  });
});

describe("saveCadetAction", () => {
  it("creates, invalidates once and redirects", async () => {
    asAdmin();
    expect(await redirectOf(saveCadetAction(prev, form({ name: "Juan", phone: "11 5555-1234", active: "on" })))).toBe(
      "/admin/cadetes",
    );
    expect(invalidateCadets).toHaveBeenCalledTimes(1);
    expect((await testDb().select().from(s.cadets))[0]).toMatchObject({
      name: "Juan",
      phone: "11 5555-1234",
      active: true,
    });
  });
  it("validation failure: field errors, values echoed, nothing invalidated or stored", async () => {
    asAdmin();
    const r = await saveCadetAction(prev, form({ name: "", phone: "abc" }));
    expect(r.fieldErrors?.name).toBeTruthy();
    expect(r.fieldErrors?.phone).toBeTruthy();
    expect(r.values?.phone).toBe("abc");
    expect(invalidateCadets).not.toHaveBeenCalled();
    expect(await testDb().select().from(s.cadets)).toHaveLength(0);
  });
});

describe("toggleCadetActiveAction", () => {
  it("toggles and invalidates once", async () => {
    asAdmin();
    const [c] = await testDb().insert(s.cadets).values({ name: "Ana" }).returning();
    expect(await toggleCadetActiveAction(prev, form({ id: String(c.id), value: "false" }))).toEqual({});
    expect(invalidateCadets).toHaveBeenCalledTimes(1);
    expect((await testDb().select().from(s.cadets))[0].active).toBe(false);
  });
  it("garbage input and unknown ids return an error without invalidating", async () => {
    asAdmin();
    expect((await toggleCadetActiveAction(prev, form({ id: "abc", value: "maybe" }))).error).toBeTruthy();
    expect(core.setCadetActive).not.toHaveBeenCalled();
    expect((await toggleCadetActiveAction(prev, form({ id: "999", value: "true" }))).error).toBeTruthy();
    expect(invalidateCadets).not.toHaveBeenCalled();
  });
  it("is blocked with a clear message while orders are en_camino", async () => {
    asAdmin();
    const [c] = await testDb().insert(s.cadets).values({ name: "Ana" }).returning();
    await testDb().insert(s.orders).values({
      businessDate: "2026-10-15",
      number: 1,
      publicToken: "t1",
      channel: "web",
      fulfillment: "delivery",
      status: "en_camino",
      paymentMethod: "cash",
      customerName: "C",
      subtotal: 1,
      total: 1,
      cadetId: c.id,
    });
    const r = await toggleCadetActiveAction(prev, form({ id: String(c.id), value: "false" }));
    expect(r.error).toBe("El cadete tiene pedidos en camino");
    expect(invalidateCadets).not.toHaveBeenCalled();
  });
});
