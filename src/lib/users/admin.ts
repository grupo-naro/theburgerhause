import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { revokeUserSessions } from "@/lib/auth/session-store";
import { pgError, UNEXPECTED, zodFieldErrors, type Result } from "@/lib/menu/admin";
import { userInputSchema } from "./schemas";

/**
 * Admin users core. No next/* imports. Users are NEVER hard-deleted (orders and
 * settlements reference them): they are deactivated, which also kills their
 * sessions. Password hashes are never selected for display: every read here
 * lists explicit, safe columns.
 *
 * Business guards (returned as `{ ok: false, error }`, never thrown):
 *  - an admin cannot deactivate THEMSELVES;
 *  - the LAST ACTIVE ADMIN can be neither deactivated nor demoted. The check
 *    runs in one transaction that first locks every active-admin row
 *    (`FOR UPDATE`, ordered by id), so two concurrent demotions serialize and
 *    the second one sees the first one's result.
 */

type Conn = Db | DbTransaction;
const asDb = (c: Conn) => c as Db;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const SELF_DEACTIVATE = "No podés desactivarte a vos mismo";
export const LAST_ADMIN = "Tiene que quedar al menos un administrador activo";
const USERNAME_TAKEN = "Ese nombre de usuario ya está en uso";

export type AdminUser = Pick<typeof s.users.$inferSelect, "id" | "name" | "username" | "role" | "active">;
export type AdminUserRow = AdminUser & { activeSessions: number };

const safeColumns = {
  id: s.users.id,
  name: s.users.name,
  username: s.users.username,
  role: s.users.role,
  active: s.users.active,
};

/** Locks all active admins (stable order) and returns their ids. Always call before locking the target. */
async function lockActiveAdmins(tx: DbTransaction): Promise<number[]> {
  const rows = await tx
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.role, "admin"), eq(s.users.active, true)))
    .orderBy(asc(s.users.id))
    .for("update");
  return rows.map((r) => r.id);
}

/**
 * Shared guard for any change that may take an admin out of "active admin".
 * `next` is the state the user is about to have. Returns an error message or null.
 */
function stateChangeError(
  target: { id: number; role: string; active: boolean },
  next: { role: string; active: boolean },
  activeAdminIds: number[],
  actingUserId: number | null,
): string | null {
  if (actingUserId === target.id && target.active && !next.active) return SELF_DEACTIVATE;
  const wasActiveAdmin = target.role === "admin" && target.active;
  const staysActiveAdmin = next.role === "admin" && next.active;
  if (wasActiveAdmin && !staysActiveAdmin && activeAdminIds.every((id) => id === target.id)) return LAST_ADMIN;
  return null;
}

export async function saveUser(db: Conn, input: unknown, actingUserId: number | null): Promise<Result<{ id: number }>> {
  const parsed = userInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  const usernameTaken = { ok: false as const, fieldErrors: { username: USERNAME_TAKEN } };

  try {
    const passwordHash = v.password === undefined ? undefined : await hashPassword(v.password);

    if (v.id === undefined) {
      if (passwordHash === undefined) return { ok: false, fieldErrors: { password: "Ingresá una contraseña" } };
      return await asDb(db).transaction(async (tx) => {
        const [dup] = await tx
          .select({ id: s.users.id })
          .from(s.users)
          .where(sql`lower(${s.users.username}) = ${v.username}`);
        if (dup) return usernameTaken;
        const [row] = await tx
          .insert(s.users)
          .values({ name: v.name, username: v.username, passwordHash, role: v.role, active: v.active })
          .returning({ id: s.users.id });
        return ok({ id: row.id });
      });
    }

    const id = v.id;
    return await asDb(db).transaction(async (tx) => {
      const activeAdmins = await lockActiveAdmins(tx);
      const [target] = await tx
        .select({ id: s.users.id, role: s.users.role, active: s.users.active })
        .from(s.users)
        .where(eq(s.users.id, id))
        .for("update");
      if (!target) return fail("El usuario no existe");

      const guard = stateChangeError(target, v, activeAdmins, actingUserId);
      if (guard) return fail(guard);

      const [dup] = await tx
        .select({ id: s.users.id })
        .from(s.users)
        .where(and(sql`lower(${s.users.username}) = ${v.username}`, ne(s.users.id, id)));
      if (dup) return usernameTaken;

      await tx
        .update(s.users)
        .set({
          name: v.name,
          username: v.username,
          role: v.role,
          active: v.active,
          ...(passwordHash === undefined ? {} : { passwordHash }),
        })
        .where(eq(s.users.id, id));
      if (passwordHash !== undefined || (target.active && !v.active)) await revokeUserSessions(tx, id);
      return ok({ id });
    });
  } catch (e) {
    if (pgError(e)?.code === "23505") return usernameTaken;
    // Never log the exception object: it can carry query parameters (hashes).
    console.error("[users] saveUser failed", pgError(e)?.code ?? "");
    return fail(UNEXPECTED);
  }
}

export async function setUserActive(
  db: Conn,
  id: number,
  active: boolean,
  actingUserId: number | null,
): Promise<Result<null>> {
  if (!Number.isInteger(id) || id <= 0) return fail("Usuario inválido");
  try {
    return await asDb(db).transaction(async (tx) => {
      const activeAdmins = await lockActiveAdmins(tx);
      const [target] = await tx
        .select({ id: s.users.id, role: s.users.role, active: s.users.active })
        .from(s.users)
        .where(eq(s.users.id, id))
        .for("update");
      if (!target) return fail("El usuario no existe");
      const guard = stateChangeError(target, { role: target.role, active }, activeAdmins, actingUserId);
      if (guard) return fail(guard);
      await tx.update(s.users).set({ active }).where(eq(s.users.id, id));
      if (!active) await revokeUserSessions(tx, id);
      return ok(null);
    });
  } catch {
    console.error("[users] setUserActive failed");
    return fail(UNEXPECTED);
  }
}

/** "Cerrar sesiones": signs the user out everywhere (no other change). */
export async function revokeAllSessionsForUser(db: Conn, id: number): Promise<Result<null>> {
  if (!Number.isInteger(id) || id <= 0) return fail("Usuario inválido");
  try {
    const [user] = await db.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, id));
    if (!user) return fail("El usuario no existe");
    await revokeUserSessions(db, id);
    return ok(null);
  } catch {
    console.error("[users] revokeAllSessionsForUser failed");
    return fail(UNEXPECTED);
  }
}

/** Users by name with how many unexpired sessions each has. Safe columns only. */
export async function listUsers(db: Conn, now: Date = new Date()): Promise<AdminUserRow[]> {
  // "users"."id" is spelled out: drizzle renders single-table columns unqualified.
  const activeSessions = sql<number>`(select count(*)::int from ${s.sessions} where ${s.sessions.userId} = "users"."id" and ${s.sessions.expiresAt} > ${now.toISOString()}::timestamptz)`;
  const rows = await db
    .select({ ...safeColumns, activeSessions })
    .from(s.users)
    .orderBy(asc(s.users.name), asc(s.users.id));
  return rows.map((r) => ({ ...r, activeSessions: Number(r.activeSessions) }));
}

export async function getUserForAdmin(db: Conn, id: number): Promise<AdminUser | null> {
  const [row] = await db.select(safeColumns).from(s.users).where(eq(s.users.id, id));
  return row ?? null;
}

export { userInputSchema } from "./schemas";
