import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/promo/cache", () => ({ invalidatePromo: vi.fn() }));
vi.mock("@/lib/promo/admin", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/promo/admin")>();
  return { ...m, savePromo: vi.fn(m.savePromo) };
});

import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { assertRole, AuthError, type AuthSession } from "@/lib/auth/roles";
import * as core from "@/lib/promo/admin";
import { invalidatePromo } from "@/lib/promo/cache";
import { form, redirectOf } from "@/test-support/next-mocks";
import { savePromoAction } from "./actions";

const IMG = "123e4567-e89b-12d3-a456-426614174000.webp";
const session = (role: "admin" | "encargado"): AuthSession => ({
  user: { id: 1, name: "U", username: "u", role },
  stationId: null,
  stationKind: null,
  sessionId: "x",
});
const asAdmin = () => vi.mocked(requireRole).mockResolvedValue(session("admin"));
const prev = {};
const valid = (over: Record<string, string> = {}) =>
  form({ imagePath: IMG, title: "Halloween", active: "on", startsAt: "", endsAt: "", ...over });

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});
afterAll(closeDb);

describe("authorization", () => {
  it("encargado is refused by the real role check; the core is never called", async () => {
    vi.mocked(requireRole).mockImplementation(async (...roles) => assertRole(session("encargado"), roles));
    expect((await savePromoAction(prev, valid())).error).toBeTruthy();
    expect(core.savePromo).not.toHaveBeenCalled();
    expect(await testDb().select().from(s.storePromo)).toHaveLength(0);
  });
  it("anonymous is sent to /login", async () => {
    vi.mocked(requireRole).mockRejectedValue(new AuthError("UNAUTHENTICATED"));
    expect(await redirectOf(savePromoAction(prev, valid()))).toBe("/login");
    expect(core.savePromo).not.toHaveBeenCalled();
    expect(invalidatePromo).not.toHaveBeenCalled();
  });
});

describe("savePromoAction", () => {
  it("saves, refreshes the admin page once and reports success", async () => {
    asAdmin();
    expect(await savePromoAction(prev, valid({ startsAt: "2026-10-31T20:00" }))).toEqual({ message: "Promoción guardada" });
    expect(invalidatePromo).toHaveBeenCalledTimes(1);
    expect(await core.getPromo(testDb())).toMatchObject({ imagePath: IMG, title: "Halloween", active: true });
  });
  it("an unchecked box saves it inactive", async () => {
    asAdmin();
    const fd = valid();
    fd.delete("active");
    await savePromoAction(prev, fd);
    expect((await core.getPromo(testDb()))!.active).toBe(false);
  });
  it("validation failure: field errors, values echoed, nothing stored or refreshed", async () => {
    asAdmin();
    const r = await savePromoAction(prev, valid({ title: "x".repeat(121), startsAt: "2026-10-31T20:00", endsAt: "2026-10-31T10:00" }));
    expect(r.fieldErrors).toMatchObject({ title: expect.any(String), endsAt: expect.any(String) });
    expect(r.values?.startsAt).toBe("2026-10-31T20:00");
    expect(invalidatePromo).not.toHaveBeenCalled();
    expect(await testDb().select().from(s.storePromo)).toHaveLength(0);
  });
});
