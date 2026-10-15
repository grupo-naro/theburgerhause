import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import {
  createSession,
  deleteExpiredSessions,
  revokeSession,
  revokeUserSessions,
  setSessionStation,
  validateSessionToken,
} from "@/lib/auth/session-store";

const db = () => testDb();
const HOUR = 3_600_000;
const NOW = new Date("2026-10-14T12:00:00Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

async function makeUser(over: Partial<typeof s.users.$inferInsert> = {}) {
  const [u] = await db()
    .insert(s.users)
    .values({ name: "Ana", username: `ana${Math.random()}`, passwordHash: "x", role: "cajera", ...over })
    .returning();
  return u;
}

async function rowFor(token: string) {
  const [row] = await db().select().from(s.sessions).where(eq(s.sessions.id, sha256(token)));
  return row;
}

beforeEach(resetDb);
afterAll(closeDb);

describe("session-store", () => {
  it("stores sha256(token), never the raw token, and expires in 12h", async () => {
    const u = await makeUser();
    const { token, expiresAt } = await createSession(db(), { userId: u.id, now: NOW });
    expect(expiresAt).toEqual(at(12));
    const rows = await db().select().from(s.sessions);
    expect(rows).toHaveLength(1);
    expect(rows.some((r) => r.id === token)).toBe(false);
    expect(rows[0].id).toBe(sha256(token));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("validate returns the user and stationId", async () => {
    const u = await makeUser({ role: "encargada_delivery", name: "Eli" });
    const [st] = await db().insert(s.stations).values({ name: "Mostrador 1", kind: "mostrador" }).returning();
    const { token } = await createSession(db(), { userId: u.id, stationId: st.id, now: NOW });
    const session = await validateSessionToken(db(), token, at(1));
    expect(session).toEqual({
      user: { id: u.id, name: "Eli", username: u.username, role: "encargada_delivery" },
      stationId: st.id,
      sessionId: sha256(token),
    });
  });

  it("returns null for an expired session", async () => {
    const u = await makeUser();
    const { token } = await createSession(db(), { userId: u.id, now: NOW });
    expect(await validateSessionToken(db(), token, at(12))).toBeNull();
    expect(await validateSessionToken(db(), token, at(13))).toBeNull();
  });

  it("renews the expiration when less than 6h remain", async () => {
    const u = await makeUser();
    const { token } = await createSession(db(), { userId: u.id, now: NOW });
    expect(await validateSessionToken(db(), token, at(7))).not.toBeNull();
    expect((await rowFor(token)).expiresAt).toEqual(at(19));
  });

  it("does not write when 6h or more remain", async () => {
    const u = await makeUser();
    const { token } = await createSession(db(), { userId: u.id, now: NOW });
    expect(await validateSessionToken(db(), token, at(1))).not.toBeNull();
    expect((await rowFor(token)).expiresAt).toEqual(at(12));
  });

  it("revoked token stops working", async () => {
    const u = await makeUser();
    const { token } = await createSession(db(), { userId: u.id, now: NOW });
    await revokeSession(db(), token);
    expect(await validateSessionToken(db(), token, at(1))).toBeNull();
    expect(await rowFor(token)).toBeUndefined();
  });

  it("revokeUserSessions kills all sessions of that user but not others", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const a1 = await createSession(db(), { userId: a.id, now: NOW });
    const a2 = await createSession(db(), { userId: a.id, now: NOW });
    const b1 = await createSession(db(), { userId: b.id, now: NOW });
    await revokeUserSessions(db(), a.id);
    expect(await validateSessionToken(db(), a1.token, at(1))).toBeNull();
    expect(await validateSessionToken(db(), a2.token, at(1))).toBeNull();
    expect(await validateSessionToken(db(), b1.token, at(1))).not.toBeNull();
  });

  it("returns null for an inactive user", async () => {
    const u = await makeUser();
    const { token } = await createSession(db(), { userId: u.id, now: NOW });
    await db().update(s.users).set({ active: false }).where(eq(s.users.id, u.id));
    expect(await validateSessionToken(db(), token, at(1))).toBeNull();
  });

  it("setSessionStation updates the station", async () => {
    const u = await makeUser();
    const [st] = await db().insert(s.stations).values({ name: "Delivery", kind: "delivery" }).returning();
    const { token } = await createSession(db(), { userId: u.id, now: NOW });
    await setSessionStation(db(), token, st.id);
    expect((await rowFor(token)).stationId).toBe(st.id);
    await setSessionStation(db(), token, null);
    expect((await rowFor(token)).stationId).toBeNull();
  });

  it("returns null (no throw) for unknown or garbage tokens", async () => {
    expect(await validateSessionToken(db(), "nope", NOW)).toBeNull();
    expect(await validateSessionToken(db(), "", NOW)).toBeNull();
    expect(await validateSessionToken(db(), "%%%\u0000x".repeat(50), NOW)).toBeNull();
  });

  it("deleteExpiredSessions removes only expired rows", async () => {
    const u = await makeUser();
    const old = await createSession(db(), { userId: u.id, now: at(-13) });
    const fresh = await createSession(db(), { userId: u.id, now: NOW });
    await deleteExpiredSessions(db(), NOW);
    expect(await rowFor(old.token)).toBeUndefined();
    expect(await rowFor(fresh.token)).toBeDefined();
  });
});
