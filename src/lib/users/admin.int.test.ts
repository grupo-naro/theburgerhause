import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session-store";
import { getUserForAdmin, listUsers, revokeAllSessionsForUser, saveUser, setUserActive } from "./admin";

const db = () => testDb();
const input = (over: Record<string, unknown> = {}) => ({
  name: "Cora",
  username: "cora",
  role: "cajera",
  active: true,
  password: "password-1",
  ...over,
});

async function create(over: Record<string, unknown> = {}) {
  const r = await saveUser(db(), input(over), null);
  if (!r.ok) throw new Error(`user failed: ${JSON.stringify(r)}`);
  return r.data.id;
}
const row = async (id: number) => (await db().select().from(s.users).where(eq(s.users.id, id)))[0];
const sessionCount = async (userId: number) =>
  (await db().select().from(s.sessions).where(eq(s.sessions.userId, userId))).length;

beforeEach(resetDb);
afterAll(closeDb);

describe("saveUser: create", () => {
  it("hashes the password (verifyPassword accepts it) and lowercases the username", async () => {
    const id = await create({ username: "Cora.Caja" });
    const u = await row(id);
    expect(u.username).toBe("cora.caja");
    expect(u.passwordHash).not.toContain("password-1");
    expect(await verifyPassword("password-1", u.passwordHash)).toBe(true);
    expect(await verifyPassword("other", u.passwordHash)).toBe(false);
  });
  it("never returns or lists the password hash", async () => {
    const r = await saveUser(db(), input(), null);
    expect(JSON.stringify(r)).not.toMatch(/scrypt|password/i);
    await create({ username: "otro" });
    const dump = JSON.stringify([await listUsers(db()), await getUserForAdmin(db(), 1)]);
    expect(dump).not.toMatch(/scrypt|passwordHash|password_hash/i);
  });
  it("requires a password and validates fields", async () => {
    expect(await saveUser(db(), input({ password: "" }), null)).toMatchObject({
      ok: false,
      fieldErrors: { password: expect.any(String) },
    });
    expect(await saveUser(db(), input({ username: "a b" }), null)).toMatchObject({
      ok: false,
      fieldErrors: { username: expect.any(String) },
    });
    expect(await db().select().from(s.users)).toHaveLength(0);
  });
  it("rejects a duplicate username case-insensitively with a field error", async () => {
    await create({ username: "cora" });
    const dup = await saveUser(db(), input({ username: "CORA" }), null);
    expect(dup).toMatchObject({ ok: false, fieldErrors: { username: expect.stringMatching(/en uso|existe/i) } });
    expect(JSON.stringify(dup)).not.toMatch(/insert|violates|constraint/i);
  });
  it("catches a legacy mixed-case username when comparing", async () => {
    await db().insert(s.users).values({ name: "Old", username: "Legacy", passwordHash: "x", role: "cajera" });
    expect(await saveUser(db(), input({ username: "legacy" }), null)).toMatchObject({
      ok: false,
      fieldErrors: { username: expect.any(String) },
    });
  });
});

describe("saveUser: edit", () => {
  it("keeps the hash when the password is blank", async () => {
    const id = await create();
    const before = (await row(id)).passwordHash;
    const r = await saveUser(db(), input({ id, name: "Cora B", password: "" }), 99);
    expect(r).toEqual({ ok: true, data: { id } });
    const after = await row(id);
    expect(after.passwordHash).toBe(before);
    expect(after.name).toBe("Cora B");
  });
  it("resets the password: new hash works, old does not, sessions are revoked", async () => {
    const id = await create();
    await createSession(db(), { userId: id });
    await createSession(db(), { userId: id });
    expect(await sessionCount(id)).toBe(2);
    await saveUser(db(), input({ id, password: "brand-new-pass" }), 99);
    const u = await row(id);
    expect(await verifyPassword("brand-new-pass", u.passwordHash)).toBe(true);
    expect(await verifyPassword("password-1", u.passwordHash)).toBe(false);
    expect(await sessionCount(id)).toBe(0);
  });
  it("keeps sessions when no password is given", async () => {
    const id = await create();
    await createSession(db(), { userId: id });
    await saveUser(db(), input({ id, name: "Nuevo nombre", password: "" }), 99);
    expect(await sessionCount(id)).toBe(1);
  });
  it("rejects a username taken by another user but allows keeping the own one", async () => {
    const a = await create({ username: "ana" });
    await create({ username: "beto" });
    expect(await saveUser(db(), input({ id: a, username: "BETO", password: "" }), 99)).toMatchObject({
      ok: false,
      fieldErrors: { username: expect.any(String) },
    });
    expect((await saveUser(db(), input({ id: a, username: "Ana", password: "" }), 99)).ok).toBe(true);
  });
  it("reports a missing user", async () => {
    expect((await saveUser(db(), input({ id: 999, password: "" }), 1)).ok).toBe(false);
  });
  it("deactivating through the edit form revokes sessions", async () => {
    const id = await create();
    await createSession(db(), { userId: id });
    expect((await saveUser(db(), input({ id, active: false, password: "" }), 99)).ok).toBe(true);
    expect(await sessionCount(id)).toBe(0);
    expect((await row(id)).active).toBe(false);
  });
});

describe("setUserActive", () => {
  it("deactivates, revokes the sessions and reactivates", async () => {
    const id = await create();
    await createSession(db(), { userId: id });
    expect((await setUserActive(db(), id, false, 99)).ok).toBe(true);
    expect((await row(id)).active).toBe(false);
    expect(await sessionCount(id)).toBe(0);
    expect((await setUserActive(db(), id, true, 99)).ok).toBe(true);
    expect((await row(id)).active).toBe(true);
  });
  it("an admin cannot deactivate themselves (even with other admins)", async () => {
    const a = await create({ username: "adm1", role: "admin" });
    await create({ username: "adm2", role: "admin" });
    expect(await setUserActive(db(), a, false, a)).toEqual({
      ok: false,
      error: "No podés desactivarte a vos mismo",
    });
    expect((await row(a)).active).toBe(true);
    // same through the edit form
    expect((await saveUser(db(), input({ id: a, username: "adm1", role: "admin", active: false, password: "" }), a)).ok).toBe(
      false,
    );
  });
  it("the last active admin can neither be deactivated nor demoted", async () => {
    const only = await create({ username: "adm1", role: "admin" });
    await create({ username: "caja", role: "cajera" });
    const msg = "Tiene que quedar al menos un administrador activo";
    expect(await setUserActive(db(), only, false, 99)).toEqual({ ok: false, error: msg });
    expect(await saveUser(db(), input({ id: only, username: "adm1", role: "cajera", password: "" }), 99)).toEqual({
      ok: false,
      error: msg,
    });
    expect(await saveUser(db(), input({ id: only, username: "adm1", role: "admin", active: false, password: "" }), 99)).toEqual({
      ok: false,
      error: msg,
    });
    expect(await row(only)).toMatchObject({ role: "admin", active: true });
  });
  it("an inactive admin does not count as an active admin", async () => {
    const a = await create({ username: "adm1", role: "admin" });
    const b = await create({ username: "adm2", role: "admin" });
    await db().update(s.users).set({ active: false }).where(eq(s.users.id, b));
    expect((await setUserActive(db(), a, false, 99)).ok).toBe(false);
  });
  it("with two admins, one can be demoted or deactivated by the other", async () => {
    const a = await create({ username: "adm1", role: "admin" });
    const b = await create({ username: "adm2", role: "admin" });
    expect((await setUserActive(db(), b, false, a)).ok).toBe(true);
    expect((await setUserActive(db(), b, true, a)).ok).toBe(true);
    expect((await saveUser(db(), input({ id: b, username: "adm2", role: "cajera", password: "" }), a)).ok).toBe(true);
  });
  it("race: two parallel deactivations of the only two admins -> exactly one succeeds", async () => {
    for (let i = 0; i < 5; i++) {
      await resetDb();
      const a = await create({ username: "adm1", role: "admin" });
      const b = await create({ username: "adm2", role: "admin" });
      const results = await Promise.all([setUserActive(db(), a, false, b), setUserActive(db(), b, false, a)]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const active = (await db().select().from(s.users)).filter((u) => u.role === "admin" && u.active);
      expect(active).toHaveLength(1);
    }
  });
  it("race: parallel demotions via saveUser also leave one admin", async () => {
    const a = await create({ username: "adm1", role: "admin" });
    const b = await create({ username: "adm2", role: "admin" });
    const demote = (id: number, username: string, by: number) =>
      saveUser(db(), input({ id, username, role: "cajera", password: "" }), by);
    const results = await Promise.all([demote(a, "adm1", b), demote(b, "adm2", a)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
  it("rejects invalid or unknown ids", async () => {
    expect((await setUserActive(db(), 999, false, 1)).ok).toBe(false);
    expect((await setUserActive(db(), 1.5, false, 1)).ok).toBe(false);
  });
});

describe("revokeAllSessionsForUser", () => {
  it("deletes only that user's sessions", async () => {
    const a = await create({ username: "ana" });
    const b = await create({ username: "beto" });
    await createSession(db(), { userId: a });
    await createSession(db(), { userId: b });
    expect((await revokeAllSessionsForUser(db(), a)).ok).toBe(true);
    expect(await sessionCount(a)).toBe(0);
    expect(await sessionCount(b)).toBe(1);
    expect((await revokeAllSessionsForUser(db(), 999)).ok).toBe(false);
  });
});

describe("listUsers", () => {
  it("lists users by name with the count of unexpired sessions", async () => {
    const a = await create({ username: "ana", name: "Ana" });
    await create({ username: "beto", name: "Beto" });
    const now = new Date("2026-10-15T12:00:00Z");
    await createSession(db(), { userId: a, now });
    await db().insert(s.sessions).values({ id: "expired", userId: a, expiresAt: new Date("2026-10-15T11:00:00Z") });
    const rows = await listUsers(db(), now);
    expect(rows.map((r) => [r.name, r.activeSessions])).toEqual([
      ["Ana", 1],
      ["Beto", 0],
    ]);
    expect(Object.keys(rows[0]).sort()).toEqual(["active", "activeSessions", "id", "name", "role", "username"]);
  });
  it("hash helper sanity: hashPassword output is what saveUser stores", async () => {
    const id = await create();
    expect((await row(id)).passwordHash).toMatch(/^scrypt\$/);
    expect(await hashPassword("x")).toMatch(/^scrypt\$/);
  });
});
