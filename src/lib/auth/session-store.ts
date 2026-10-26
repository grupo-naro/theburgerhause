import { createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import { sessions, stations, users } from "@/db/schema";
import type { AuthSession, Role } from "@/lib/auth/roles";

type Executor = Db | DbTransaction;

const HOUR_MS = 3_600_000;
export const SESSION_TTL_MS = 12 * HOUR_MS;
/**
 * The counter TV (/pantalla) is logged in once with the `cocina` user and left on for days, sometimes switched off over
 * a weekend: its session must not die of inactivity. 400 days (the browser's cookie maximum), sliding.
 */
export const KIOSK_SESSION_TTL_MS = 400 * 24 * HOUR_MS;

/** Lifetime of a session by role: only `cocina` (the TV's login) gets the long one. */
export function sessionTtlMs(role: Role): number {
  return role === "cocina" ? KIOSK_SESSION_TTL_MS : SESSION_TTL_MS;
}

/** The DB key of a session: sha256 hex of the raw token (raw tokens are never stored). */
function tokenId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** `role` decides the lifetime (see `sessionTtlMs`); when omitted it is read from the user. */
export async function createSession(
  db: Executor,
  { userId, stationId = null, now = new Date(), role }: { userId: number; stationId?: number | null; now?: Date; role?: Role },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const userRole = role ?? (await db.select({ role: users.role }).from(users).where(eq(users.id, userId)))[0]?.role;
  const expiresAt = new Date(now.getTime() + (userRole ? sessionTtlMs(userRole) : SESSION_TTL_MS));
  await db.insert(sessions).values({ id: tokenId(token), userId, stationId, expiresAt });
  return { token, expiresAt };
}

/**
 * Null for unknown, expired or inactive-user sessions. Slides the expiry (one write at most, once less than half the
 * role's lifetime remains) unless `slide: false` (machine checks must not count as activity).
 */
export async function validateSessionToken(
  db: Executor,
  token: string,
  now: Date = new Date(),
  { slide = true }: { slide?: boolean } = {},
): Promise<AuthSession | null> {
  if (typeof token !== "string" || token.length === 0) return null;
  const id = tokenId(token);
  const [row] = await db
    .select({
      expiresAt: sessions.expiresAt,
      stationId: sessions.stationId,
      stationKind: stations.kind,
      userId: users.id,
      name: users.name,
      username: users.username,
      role: users.role,
      active: users.active,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(stations, eq(stations.id, sessions.stationId))
    .where(eq(sessions.id, id));
  if (!row || !row.active) return null;
  const remaining = row.expiresAt.getTime() - now.getTime();
  if (remaining <= 0) return null;
  const ttl = sessionTtlMs(row.role);
  if (remaining > ttl) {
    // The user's role changed since login (e.g. the TV's user turned into a cashier): never keep a longer term than
    // the current role allows.
    await db
      .update(sessions)
      .set({ expiresAt: new Date(now.getTime() + ttl) })
      .where(eq(sessions.id, id));
  } else if (slide && remaining < ttl / 2) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(now.getTime() + ttl) })
      .where(eq(sessions.id, id));
  }
  return {
    user: { id: row.userId, name: row.name, username: row.username, role: row.role },
    stationId: row.stationId,
    stationKind: row.stationKind ?? null,
    sessionId: id,
  };
}

export async function setSessionStation(db: Executor, token: string, stationId: number | null): Promise<void> {
  await db.update(sessions).set({ stationId }).where(eq(sessions.id, tokenId(token)));
}

export async function revokeSession(db: Executor, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, tokenId(token)));
}

/** Revokes every session of a user (e.g. on deactivation or password reset). */
export async function revokeUserSessions(db: Executor, userId: number): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteExpiredSessions(db: Executor, now: Date = new Date()): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
}
