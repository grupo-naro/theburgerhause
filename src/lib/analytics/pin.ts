import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { UNEXPECTED, zodFieldErrors, type Result } from "@/lib/menu/admin";
import { beginPinAttempt, endPinAttempt, isPinBlocked, recordPinFailure } from "./pin-rate-limit";
import { pinInputSchema } from "./schemas";

/** Analytics PIN (one per store, hashed in `settings`) and its per-session unlock. No next/* imports. */

export const UNLOCK_MS = 15 * 60 * 1000;
const PIN_KEY = "analytics_pin_hash";
export const NO_PIN_MESSAGE = "Configurá el PIN en Ajustes";
export const PIN_BUSY_MESSAGE = "Esperá un momento y probá de nuevo";

const blockedMessage = (retryAfterMs: number) => `Demasiados intentos, probá en ${Math.max(1, Math.ceil(retryAfterMs / 60_000))} min`;

async function getPinHash(db: Db): Promise<string | null> {
  const [row] = await db
    .select({ value: sql<string>`${s.settings.value} #>> '{}'` })
    .from(s.settings)
    .where(eq(s.settings.key, PIN_KEY));
  return row?.value ?? null;
}

export async function hasAnalyticsPin(db: Db): Promise<boolean> {
  return (await getPinHash(db)) !== null;
}

export async function setAnalyticsPin(db: Db, userId: number, input: unknown): Promise<Result<null>> {
  const parsed = pinInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error.issues) };
  const blocked = isPinBlocked(userId);
  if (blocked.blocked) return { ok: false, fieldErrors: { password: blockedMessage(blocked.retryAfterMs) } };
  if (!beginPinAttempt(userId)) return { ok: false, fieldErrors: { password: PIN_BUSY_MESSAGE } };
  try {
    const [user] = await db.select({ hash: s.users.passwordHash }).from(s.users).where(eq(s.users.id, userId));
    if (!user || !(await verifyPassword(parsed.data.password, user.hash))) {
      recordPinFailure(userId);
      return { ok: false, fieldErrors: { password: "Contraseña incorrecta" } };
    }
    const hash = await hashPassword(parsed.data.pin);
    await db
      .insert(s.settings)
      .values({ key: PIN_KEY, value: hash })
      .onConflictDoUpdate({ target: s.settings.key, set: { value: hash } });
    return { ok: true, data: null };
  } catch {
    console.error("[analytics] setAnalyticsPin failed");
    return { ok: false, error: UNEXPECTED };
  } finally {
    endPinAttempt(userId);
  }
}

export async function unlockAnalytics(
  db: Db,
  { sessionId, userId, pin, now = new Date() }: { sessionId: string; userId: number; pin: string; now?: Date },
): Promise<Result<{ until: Date }>> {
  const blocked = isPinBlocked(userId);
  if (blocked.blocked) return { ok: false, error: blockedMessage(blocked.retryAfterMs) };
  if (!beginPinAttempt(userId)) return { ok: false, error: PIN_BUSY_MESSAGE };
  try {
    const hash = await getPinHash(db);
    if (!hash) return { ok: false, error: NO_PIN_MESSAGE };
    if (!(await verifyPassword(pin, hash))) {
      recordPinFailure(userId);
      return { ok: false, error: "PIN incorrecto" };
    }
    const until = new Date(now.getTime() + UNLOCK_MS);
    await db
      .update(s.sessions)
      .set({ analyticsUnlockedUntil: until })
      .where(and(eq(s.sessions.id, sessionId), eq(s.sessions.userId, userId)));
    return { ok: true, data: { until } };
  } finally {
    endPinAttempt(userId);
  }
}

export async function lockAnalytics(db: Db, sessionId: string): Promise<void> {
  await db.update(s.sessions).set({ analyticsUnlockedUntil: null }).where(eq(s.sessions.id, sessionId));
}

/** The unlock deadline of this session, or null when locked/expired. */
export async function getAnalyticsUnlock(db: Db, sessionId: string, now: Date = new Date()): Promise<Date | null> {
  const [row] = await db.select({ until: s.sessions.analyticsUnlockedUntil }).from(s.sessions).where(eq(s.sessions.id, sessionId));
  const until = row?.until ?? null;
  return until && until.getTime() > now.getTime() ? until : null;
}
