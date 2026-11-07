import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));

import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { getAnalyticsUnlock, setAnalyticsPin } from "@/lib/analytics/pin";
import { resetPinRateLimit } from "@/lib/analytics/pin-rate-limit";
import { hashPassword } from "@/lib/auth/password";
import { requireRole } from "@/lib/auth/require-role";
import { assertRole, AuthError, type AuthSession, type Role } from "@/lib/auth/roles";
import { form, redirectOf } from "@/test-support/next-mocks";
import { lockAnalyticsAction, unlockAnalyticsAction } from "./actions";

const session = (role: Role, sessionId = "s1"): AuthSession => ({
  user: { id: 1, name: "U", username: "u", role },
  stationId: null,
  stationKind: null,
  sessionId,
});
const as = (role: Role) => vi.mocked(requireRole).mockImplementation(async (...roles) => assertRole(session(role), roles));
const prev = {};
let hash: string;

beforeAll(async () => {
  hash = await hashPassword("secreta");
});
beforeEach(async () => {
  await resetDb();
  resetPinRateLimit();
  vi.clearAllMocks();
  await testDb().insert(s.users).values({ name: "U", username: "u", passwordHash: hash, role: "admin" });
  const exp = new Date(Date.now() + 3_600_000);
  await testDb().insert(s.sessions).values([
    { id: "s1", userId: 1, expiresAt: exp },
    { id: "s2", userId: 1, expiresAt: exp },
  ]);
  expect(await setAnalyticsPin(testDb(), 1, { pin: "2468", pinConfirm: "2468", password: "secreta" })).toEqual({ ok: true, data: null });
});
afterAll(closeDb);

describe("authorization", () => {
  it("encargado is refused and the session stays locked", async () => {
    as("encargado");
    expect((await unlockAnalyticsAction(prev, form({ pin: "2468" }))).error).toBeTruthy();
    expect(await getAnalyticsUnlock(testDb(), "s1")).toBeNull();
  });
  it("anonymous is sent to /login", async () => {
    vi.mocked(requireRole).mockRejectedValue(new AuthError("UNAUTHENTICATED"));
    expect(await redirectOf(unlockAnalyticsAction(prev, form({ pin: "2468" })))).toBe("/login");
    expect(await redirectOf(lockAnalyticsAction())).toBe("/login");
  });
});

describe("unlockAnalyticsAction", () => {
  it("the right pin unlocks the caller's session only", async () => {
    as("admin");
    expect(await unlockAnalyticsAction(prev, form({ pin: "2468" }))).toEqual({});
    expect(await getAnalyticsUnlock(testDb(), "s1")).not.toBeNull();
    expect(await getAnalyticsUnlock(testDb(), "s2")).toBeNull();
  });
  it("a wrong pin is refused and never echoed", async () => {
    as("admin");
    const r = await unlockAnalyticsAction(prev, form({ pin: "1111" }));
    expect(r.error).toBe("PIN incorrecto");
    expect(r.values).toBeUndefined();
    expect(await getAnalyticsUnlock(testDb(), "s1")).toBeNull();
  });
});

describe("lockAnalyticsAction", () => {
  it("lock clears the unlock", async () => {
    as("admin");
    await unlockAnalyticsAction(prev, form({ pin: "2468" }));
    expect(await lockAnalyticsAction()).toEqual({});
    expect(await getAnalyticsUnlock(testDb(), "s1")).toBeNull();
  });
});
