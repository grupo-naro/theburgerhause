import { asc, eq, sql } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { pgError, UNEXPECTED, zodFieldErrors, type Result } from "@/lib/menu/admin";
import { cadetInputSchema } from "./schemas";

/**
 * Admin cadets core. No next/* imports. No hard deletes: cadets are deactivated
 * (settlements and orders reference them). Duplicate names are allowed on
 * purpose (two cadets can share a name); the UI only warns about it.
 */

type Conn = Db | DbTransaction;
const asDb = (c: Conn) => c as Db;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const CADET_ON_ROUTE = "El cadete tiene pedidos en camino";

export type AdminCadet = typeof s.cadets.$inferSelect;
export type AdminCadetRow = AdminCadet & { enCamino: number };

/** Locks the cadet row and tells whether it has orders `en_camino`. */
async function lockCadet(tx: DbTransaction, id: number) {
  const [cadet] = await tx.select().from(s.cadets).where(eq(s.cadets.id, id)).for("update");
  if (!cadet) return null;
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(s.orders)
    .where(sql`${s.orders.cadetId} = ${id} and ${s.orders.status} = 'en_camino'`);
  return { cadet, enCamino: Number(n) };
}

export async function saveCadet(db: Conn, input: unknown): Promise<Result<{ id: number }>> {
  const parsed = cadetInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: zodFieldErrors(parsed.error.issues) };
  const v = parsed.data;
  try {
    if (v.id === undefined) {
      const [row] = await db
        .insert(s.cadets)
        .values({ name: v.name, phone: v.phone, active: v.active })
        .returning({ id: s.cadets.id });
      return ok({ id: row.id });
    }
    const id = v.id;
    return await asDb(db).transaction(async (tx) => {
      const locked = await lockCadet(tx, id);
      if (!locked) return fail("El cadete no existe");
      if (!v.active && locked.cadet.active && locked.enCamino > 0) return fail(CADET_ON_ROUTE);
      await tx.update(s.cadets).set({ name: v.name, phone: v.phone, active: v.active }).where(eq(s.cadets.id, id));
      return ok({ id });
    });
  } catch (e) {
    console.error("[cadets] saveCadet failed", pgError(e)?.code ?? "");
    return fail(UNEXPECTED);
  }
}

export async function setCadetActive(db: Conn, id: number, active: boolean): Promise<Result<null>> {
  if (!Number.isInteger(id) || id <= 0) return fail("Cadete inválido");
  try {
    return await asDb(db).transaction(async (tx) => {
      const locked = await lockCadet(tx, id);
      if (!locked) return fail("El cadete no existe");
      if (!active && locked.cadet.active && locked.enCamino > 0) return fail(CADET_ON_ROUTE);
      await tx.update(s.cadets).set({ active }).where(eq(s.cadets.id, id));
      return ok(null);
    });
  } catch {
    console.error("[cadets] setCadetActive failed");
    return fail(UNEXPECTED);
  }
}

// NOTE: drizzle renders single-table columns unqualified, so the outer id is spelled out
// ("cadets"."id"); an unqualified `id` would resolve to orders.id inside the subquery.
/** All cadets by name, with how many of their orders are currently `en_camino`. */
export async function listCadets(db: Conn): Promise<AdminCadetRow[]> {
  const enCamino = sql<number>`(select count(*)::int from ${s.orders} where ${s.orders.cadetId} = "cadets"."id" and ${s.orders.status} = 'en_camino')`;
  const rows = await db
    .select({ id: s.cadets.id, name: s.cadets.name, phone: s.cadets.phone, active: s.cadets.active, enCamino })
    .from(s.cadets)
    .orderBy(asc(s.cadets.name), asc(s.cadets.id));
  return rows.map((r) => ({ ...r, enCamino: Number(r.enCamino) }));
}

export async function getCadetForAdmin(db: Conn, id: number): Promise<AdminCadet | null> {
  const [row] = await db.select().from(s.cadets).where(eq(s.cadets.id, id));
  return row ?? null;
}

export { cadetInputSchema } from "./schemas";
