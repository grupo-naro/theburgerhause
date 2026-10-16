import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => (await import("@/test-support/next-mocks")).nextNavigationMock);
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/users/cache", () => ({ invalidateUsers: vi.fn() }));
vi.mock("@/lib/users/admin", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/users/admin")>();
  return {
    ...m,
    saveUser: vi.fn(m.saveUser),
    setUserActive: vi.fn(m.setUserActive),
    revokeAllSessionsForUser: vi.fn(m.revokeAllSessionsForUser),
  };
});

import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { requireRole } from "@/lib/auth/require-role";
import { AuthError, type AuthSession } from "@/lib/auth/roles";
import { createSession } from "@/lib/auth/session-store";
import * as core from "@/lib/users/admin";
import { invalidateUsers } from "@/lib/users/cache";
import { form, redirectOf } from "@/test-support/next-mocks";
import { revokeSessionsAction, saveUserAction, toggleUserActiveAction } from "./actions";

const session = (role: "admin" | "cajera", id = 1): AuthSession => ({
  user: { id, name: "U", username: "u", role },
  stationId: null,
  stationKind: null,
  sessionId: "x",
});
const asAdmin = (id = 1) => vi.mocked(requireRole).mockResolvedValue(session("admin", id));
const asCajera = () => vi.mocked(requireRole).mockRejectedValue(new AuthError("FORBIDDEN"));
const anonymous = () => vi.mocked(requireRole).mockRejectedValue(new AuthError("UNAUTHENTICATED"));
const prev = {};

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});
afterAll(closeDb);

const newUser = (over: Record<string, string> = {}) =>
  form({ name: "Cora", username: "Cora", role: "cajera", active: "on", password: "password-1", ...over });
async function insertUser(username: string, role: "admin" | "cajera" = "cajera") {
  const [u] = await testDb()
    .insert(s.users)
    .values({ name: username, username, passwordHash: "h", role })
    .returning({ id: s.users.id });
  return u.id;
}

describe("authorization", () => {
  const calls: [string, () => Promise<unknown>, () => unknown][] = [
    ["saveUserAction", () => saveUserAction(prev, newUser()), () => core.saveUser],
    ["toggleUserActiveAction", () => toggleUserActiveAction(prev, form({ id: "1", value: "false" })), () => core.setUserActive],
    ["revokeSessionsAction", () => revokeSessionsAction(prev, form({ id: "1" })), () => core.revokeAllSessionsForUser],
  ];
  it.each(calls)("%s: cajera gets an error and the core is never called", async (_n, run, spy) => {
    asCajera();
    expect(((await run()) as { error?: string }).error).toBeTruthy();
    expect(spy()).not.toHaveBeenCalled();
    expect(invalidateUsers).not.toHaveBeenCalled();
    expect(await testDb().select().from(s.users)).toHaveLength(0);
  });
  it.each(calls)("%s: anonymous is sent to /login", async (_n, run, spy) => {
    anonymous();
    expect(await redirectOf(run())).toBe("/login");
    expect(spy()).not.toHaveBeenCalled();
    expect(invalidateUsers).not.toHaveBeenCalled();
  });
});

describe("saveUserAction", () => {
  it("creates a user, invalidates once and redirects", async () => {
    asAdmin();
    expect(await redirectOf(saveUserAction(prev, newUser()))).toBe("/admin/usuarios");
    expect(invalidateUsers).toHaveBeenCalledTimes(1);
    expect((await testDb().select().from(s.users))[0]).toMatchObject({ username: "cora", role: "cajera" });
  });
  it("validation failure: field errors, values echoed WITHOUT the password, no invalidation", async () => {
    asAdmin();
    const r = await saveUserAction(prev, newUser({ username: "a b", password: "short" }));
    expect(r.fieldErrors?.username).toBeTruthy();
    expect(r.fieldErrors?.password).toBeTruthy();
    expect(r.values?.username).toBe("a b");
    expect(JSON.stringify(r)).not.toContain("short");
    expect(r.values).not.toHaveProperty("password");
    expect(invalidateUsers).not.toHaveBeenCalled();
  });
  it("duplicate username (case-insensitive) is a field error", async () => {
    asAdmin();
    await redirectOf(saveUserAction(prev, newUser()));
    vi.mocked(invalidateUsers).mockClear();
    const r = await saveUserAction(prev, newUser({ username: "CORA" }));
    expect(r.fieldErrors?.username).toBeTruthy();
    expect(invalidateUsers).not.toHaveBeenCalled();
  });
  it("uses the session user (not the form) as the acting admin", async () => {
    const a = await insertUser("adm1", "admin");
    await insertUser("adm2", "admin");
    asAdmin(a);
    const r = await saveUserAction(
      prev,
      form({ id: String(a), name: "adm1", username: "adm1", role: "admin", password: "", actingUserId: "999" }),
    );
    expect(r.error).toBe(core.SELF_DEACTIVATE);
    expect(invalidateUsers).not.toHaveBeenCalled();
  });
});

describe("toggleUserActiveAction", () => {
  it("deactivates, revokes sessions and invalidates once", async () => {
    asAdmin(99);
    const id = await insertUser("cora");
    await createSession(testDb(), { userId: id });
    expect(await toggleUserActiveAction(prev, form({ id: String(id), value: "false" }))).toEqual({});
    expect(invalidateUsers).toHaveBeenCalledTimes(1);
    expect((await testDb().select().from(s.sessions).where(eq(s.sessions.userId, id)))).toHaveLength(0);
  });
  it("an admin cannot deactivate themselves (session identity)", async () => {
    const a = await insertUser("adm1", "admin");
    await insertUser("adm2", "admin");
    asAdmin(a);
    expect((await toggleUserActiveAction(prev, form({ id: String(a), value: "false" }))).error).toBe(core.SELF_DEACTIVATE);
    expect(invalidateUsers).not.toHaveBeenCalled();
  });
  it("the only admin is protected", async () => {
    const a = await insertUser("adm1", "admin");
    asAdmin(99);
    expect((await toggleUserActiveAction(prev, form({ id: String(a), value: "false" }))).error).toBe(core.LAST_ADMIN);
    expect(invalidateUsers).not.toHaveBeenCalled();
  });
  it("garbage input returns an error without touching the core", async () => {
    asAdmin();
    expect((await toggleUserActiveAction(prev, form({ id: "x", value: "maybe" }))).error).toBeTruthy();
    expect(core.setUserActive).not.toHaveBeenCalled();
  });
  it("an unexpected throw becomes a fixed generic message", async () => {
    asAdmin();
    vi.mocked(core.setUserActive).mockRejectedValueOnce(new Error("secret db detail postgres://u:p@h"));
    const r = await toggleUserActiveAction(prev, form({ id: "1", value: "false" }));
    expect(r.error).toBe("No se pudo completar la acción. Probá de nuevo.");
    expect(JSON.stringify(r)).not.toMatch(/secret|postgres/);
    expect(invalidateUsers).not.toHaveBeenCalled();
  });
});

describe("revokeSessionsAction", () => {
  it("revokes all sessions once and invalidates once", async () => {
    asAdmin();
    const id = await insertUser("cora");
    await createSession(testDb(), { userId: id });
    await createSession(testDb(), { userId: id });
    expect(await revokeSessionsAction(prev, form({ id: String(id) }))).toEqual({});
    expect(invalidateUsers).toHaveBeenCalledTimes(1);
    expect(await testDb().select().from(s.sessions)).toHaveLength(0);
  });
  it("unknown or malformed ids do not invalidate", async () => {
    asAdmin();
    expect((await revokeSessionsAction(prev, form({ id: "999" }))).error).toBeTruthy();
    expect((await revokeSessionsAction(prev, form({ id: "zz" }))).error).toBeTruthy();
    expect(invalidateUsers).not.toHaveBeenCalled();
  });
});
