import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));

import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession, type Role } from "@/lib/auth/roles";
import { getActiveDelay } from "@/lib/delay/notices";
import { redirectOf } from "@/test-support/next-mocks";
import { seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { activateDelayAction, deactivateDelayAction } from "./actions";

let fx: Fx;
const as = (role: Role) =>
  vi.mocked(requireRole).mockResolvedValue({
    user: { id: fx.userId, name: "U", username: "u", role },
    stationId: null,
    stationKind: null,
    sessionId: "x",
  } satisfies AuthSession);
const rows = () => testDb().select().from(s.delayNotices);

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  fx = await seedMenuAndStaff();
});
afterAll(closeDb);

describe("authorization", () => {
  it("anonymous is sent to /login and nothing is written", async () => {
    vi.mocked(requireRole).mockRejectedValue(new AuthError("UNAUTHENTICATED"));
    expect(await redirectOf(activateDelayAction({ extraMinutes: 10, reason: "x" }))).toBe("/login");
    expect(await redirectOf(deactivateDelayAction())).toBe("/login");
    expect(await rows()).toHaveLength(0);
  });

  it("cocina (outside the allowed set) gets a generic error and nothing is written", async () => {
    vi.mocked(requireRole).mockRejectedValue(new AuthError("FORBIDDEN"));
    const a = await activateDelayAction({ extraMinutes: 10, reason: "x" });
    expect(a).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await deactivateDelayAction()).ok).toBe(false);
    expect(await rows()).toHaveLength(0);
  });

  it("requires exactly the staff roles", async () => {
    as("cajera");
    await activateDelayAction({ extraMinutes: 10, reason: "x" });
    expect(vi.mocked(requireRole)).toHaveBeenCalledWith("cajera", "encargada_delivery", "admin", "encargado");
  });
});

describe("activate / deactivate", () => {
  it.each(["cajera", "encargada_delivery", "encargado", "admin"] as const)("%s can activate and clear", async (role) => {
    as(role);
    const r = await activateDelayAction({ extraMinutes: 15, reason: "Se pinchó el delivery" });
    expect(r).toMatchObject({ ok: true, data: { extraMinutes: 15, reason: "Se pinchó el delivery" } });
    expect(await getActiveDelay(testDb())).not.toBeNull();
    expect(await deactivateDelayAction()).toEqual({ ok: true, data: { wasActive: true } });
    expect(await getActiveDelay(testDb())).toBeNull();
    expect(await rows()).toHaveLength(1);
  });

  it("invalid minutes or an empty reason return a validation result and write nothing", async () => {
    as("cajera");
    for (const input of [
      { extraMinutes: 7, reason: "x" },
      { extraMinutes: 90, reason: "x" },
      { extraMinutes: 10, reason: "   " },
      { extraMinutes: "10", reason: "x" },
      null,
    ]) {
      const r = await activateDelayAction(input);
      expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    }
    expect(await rows()).toHaveLength(0);
  });

  it("deactivating with no active delay is ok with wasActive false", async () => {
    as("cajera");
    expect(await deactivateDelayAction()).toEqual({ ok: true, data: { wasActive: false } });
  });
});
