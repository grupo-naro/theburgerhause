import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { upsertAdmin } from "@/db/seed-admin";
import { resetDb, testDb } from "@/db/test-utils";
import { createSession, validateSessionToken } from "@/lib/auth/session-store";
import { verifyPassword } from "@/lib/auth/password";

const db = () => testDb();

beforeEach(resetDb);
afterAll(closeDb);

describe("upsertAdmin", () => {
  it("creating twice leaves one admin row", async () => {
    await upsertAdmin(db(), { username: "admin", password: "first-password" });
    await upsertAdmin(db(), { username: "admin", password: "first-password" });
    const rows = await db().select().from(s.users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ username: "admin", role: "admin", active: true });
  });

  it("a second call with a new password resets it", async () => {
    await upsertAdmin(db(), { username: "admin", password: "old-password" });
    const [before] = await db().select().from(s.users);
    await upsertAdmin(db(), { username: "admin", password: "new-password" });
    const [after] = await db().select().from(s.users);
    expect(after.passwordHash).not.toBe(before.passwordHash);
    expect(await verifyPassword("new-password", after.passwordHash)).toBe(true);
    expect(await verifyPassword("old-password", after.passwordHash)).toBe(false);
  });

  it("revokes existing sessions on password reset", async () => {
    await upsertAdmin(db(), { username: "admin", password: "old-password" });
    const [u] = await db().select().from(s.users);
    const { token } = await createSession(db(), { userId: u.id });
    await upsertAdmin(db(), { username: "admin", password: "new-password" });
    expect(await validateSessionToken(db(), token)).toBeNull();
  });
});
