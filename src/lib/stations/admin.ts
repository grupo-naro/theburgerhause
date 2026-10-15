import { asc, eq, sql } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { pgError, UNEXPECTED, zodFieldErrors, type Result } from "@/lib/menu/admin";
import { connectionState, renameInputSchema, stationInputSchema, type ConnectionState } from "./schemas";
import { generateStationToken, hashStationToken } from "./token";

/**
 * Admin stations core. No next/* imports.
 *
 * Tokens: the PLAIN token is returned exactly once (create / rotate) inside
 * the Result and is never stored, logged, or put in a URL or cookie; the DB
 * keeps only its sha256 (`token_hash`). Rotating overwrites the hash, so the
 * previous token stops working immediately.
 *
 * There is intentionally NO delete: stations are referenced by print jobs
 * (`ON DELETE RESTRICT`), sessions and orders. YAGNI until a real need shows up.
 */

type Conn = Db | DbTransaction;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const NAME_TAKEN = { name: "Ya existe una estación con ese nombre" };

export type AdminStation = { id: number; name: string; kind: (typeof s.stations.$inferSelect)["kind"] };
export type AdminStationRow = AdminStation & {
  lastSeenAt: Date | null;
  connection: ConnectionState;
  hasToken: boolean;
};

export async function createStation(
  db: Conn,
  input: unknown,
): Promise<Result<{ station: AdminStation; token: string }>> {
  const parsed = stationInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error.issues) };
  const token = generateStationToken();
  try {
    const [station] = await db
      .insert(s.stations)
      .values({ name: parsed.data.name, kind: parsed.data.kind, tokenHash: hashStationToken(token) })
      .returning({ id: s.stations.id, name: s.stations.name, kind: s.stations.kind });
    return ok({ station, token });
  } catch (e) {
    if (pgError(e)?.code === "23505") return { ok: false, fieldErrors: NAME_TAKEN };
    console.error("[stations] createStation failed", pgError(e)?.code ?? "");
    return fail(UNEXPECTED);
  }
}

/** New token for an existing station (also the way to give a seeded station its first one). */
export async function rotateStationToken(db: Conn, id: number): Promise<Result<{ token: string }>> {
  if (!Number.isInteger(id) || id <= 0) return fail("Estación inválida");
  const token = generateStationToken();
  try {
    const rows = await db
      .update(s.stations)
      .set({ tokenHash: hashStationToken(token) })
      .where(eq(s.stations.id, id))
      .returning({ id: s.stations.id });
    return rows.length ? ok({ token }) : fail("La estación no existe");
  } catch {
    console.error("[stations] rotateStationToken failed");
    return fail(UNEXPECTED);
  }
}

export async function renameStation(db: Conn, input: unknown): Promise<Result<{ id: number }>> {
  const parsed = renameInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error.issues) };
  const { id, name } = parsed.data;
  try {
    const rows = await db.update(s.stations).set({ name }).where(eq(s.stations.id, id)).returning({ id: s.stations.id });
    return rows.length ? ok({ id }) : fail("La estación no existe");
  } catch (e) {
    if (pgError(e)?.code === "23505") return { ok: false, fieldErrors: NAME_TAKEN };
    console.error("[stations] renameStation failed", pgError(e)?.code ?? "");
    return fail(UNEXPECTED);
  }
}

/** Safe columns only (never the hash): `hasToken` is derived in SQL. */
export async function listStationsForAdmin(db: Conn, now: Date = new Date()): Promise<AdminStationRow[]> {
  const rows = await db
    .select({
      id: s.stations.id,
      name: s.stations.name,
      kind: s.stations.kind,
      lastSeenAt: s.stations.lastSeenAt,
      hasToken: sql<boolean>`${s.stations.tokenHash} is not null`,
    })
    .from(s.stations)
    .orderBy(asc(s.stations.id));
  return rows.map((r) => ({ ...r, hasToken: Boolean(r.hasToken), connection: connectionState(r.lastSeenAt, now) }));
}

export async function getStationForAdmin(db: Conn, id: number): Promise<AdminStation | null> {
  const [row] = await db
    .select({ id: s.stations.id, name: s.stations.name, kind: s.stations.kind })
    .from(s.stations)
    .where(eq(s.stations.id, id));
  return row ?? null;
}

export { stationInputSchema } from "./schemas";
