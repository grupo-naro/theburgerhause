import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { createSession, revokeSession, validateSessionToken } from "@/lib/auth/session-store";
import type { AuthSession } from "@/lib/auth/roles";
import { eq } from "drizzle-orm";
import { defaultRevalidate } from "./sse";

const db = () => testDb();
const reqWith = (token: string | null) =>
  new Request("http://localhost/api/events", { headers: token ? { cookie: `x=1; ${SESSION_COOKIE}=${token}` } : {} });
const asSession = (id: number): AuthSession => ({ user: { id, name: "n", username: "u", role: "cajera" }, stationId: null, stationKind: null, sessionId: "s" });

let userId: number;
beforeEach(async () => {
  await resetDb();
  const [u] = await db().insert(s.users).values({ name: "Cora", username: "cora", passwordHash: "x", role: "cajera" }).returning();
  userId = u.id;
});
afterAll(closeDb);

describe("defaultRevalidate (cookie -> DB)", () => {
  it("valid while the session lives; false once revoked, deactivated, missing or of another user", async () => {
    const { token } = await createSession(db(), { userId });
    expect(await defaultRevalidate(reqWith(token), asSession(userId))).toBe(true);
    expect(await defaultRevalidate(reqWith(token), asSession(userId + 1))).toBe(false);
    expect(await defaultRevalidate(reqWith(null), asSession(userId))).toBe(false);
    expect(await defaultRevalidate(reqWith("garbage"), asSession(userId))).toBe(false);

    await db().update(s.users).set({ active: false }).where(eq(s.users.id, userId));
    expect(await defaultRevalidate(reqWith(token), asSession(userId))).toBe(false);
    await db().update(s.users).set({ active: true }).where(eq(s.users.id, userId));
    expect(await defaultRevalidate(reqWith(token), asSession(userId))).toBe(true);

    await revokeSession(db(), token);
    expect(await defaultRevalidate(reqWith(token), asSession(userId))).toBe(false);
  });

  it("an expired session is invalid", async () => {
    const { token } = await createSession(db(), { userId, now: new Date(Date.now() - 13 * 3_600_000) });
    expect(await defaultRevalidate(reqWith(token), asSession(userId))).toBe(false);
  });
});

describe("sliding (the stream is not user activity)", () => {
  const expiryOf = async (token: string) => {
    const { createHash } = await import("node:crypto");
    const id = createHash("sha256").update(token).digest("hex");
    const [row] = await db().select().from(s.sessions).where(eq(s.sessions.id, id));
    return row.expiresAt.getTime();
  };

  it("defaultRevalidate inside the renew window is true and leaves expires_at UNCHANGED", async () => {
    const { token } = await createSession(db(), { userId, now: new Date(Date.now() - 7 * 3_600_000) }); // ~5 h left
    const before = await expiryOf(token);
    expect(await defaultRevalidate(reqWith(token), asSession(userId))).toBe(true);
    expect(await expiryOf(token)).toBe(before);
  });

  it("regression guard: the default validateSessionToken still slides", async () => {
    const { token } = await createSession(db(), { userId, now: new Date(Date.now() - 7 * 3_600_000) });
    const before = await expiryOf(token);
    expect(await validateSessionToken(db(), token)).not.toBeNull();
    expect(await expiryOf(token)).toBeGreaterThan(before);
  });
});
