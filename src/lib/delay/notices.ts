import { eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { DELAY_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";
import { zodFieldErrors, type Result } from "@/lib/menu/admin";
import { pgError } from "@/lib/orders/order-rows";
import { activateDelaySchema } from "./schemas";

/**
 * Manual delay notices (server). History is kept: a notice is closed with ended_by/ended_at, never
 * deleted. The partial unique index delay_notices_one_active guarantees at most one open notice.
 * `reason` is staff-only data: it never reaches the public estimate.
 */

export type ActiveDelay = { id: number; extraMinutes: number; reason: string; startedAt: string; startedByName: string };

const ONE_ACTIVE_INDEX = "delay_notices_one_active";

export async function getActiveDelay(db: Db): Promise<ActiveDelay | null> {
  const [r] = await db
    .select({
      id: s.delayNotices.id,
      extraMinutes: s.delayNotices.extraMinutes,
      reason: s.delayNotices.reason,
      startedAt: s.delayNotices.startedAt,
      startedByName: s.users.name,
    })
    .from(s.delayNotices)
    .innerJoin(s.users, eq(s.users.id, s.delayNotices.startedBy))
    .where(isNull(s.delayNotices.endedAt))
    .limit(1);
  return r ? { ...r, startedAt: r.startedAt.toISOString() } : null;
}

async function activateOnce(db: Db, userId: number, extraMinutes: number, reason: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx
      .update(s.delayNotices)
      .set({ endedBy: userId, endedAt: new Date() })
      .where(isNull(s.delayNotices.endedAt));
    const [row] = await tx
      .insert(s.delayNotices)
      .values({ extraMinutes, reason, startedBy: userId })
      .returning({ id: s.delayNotices.id });
    await notifyInTx(tx, DELAY_CHANNEL, { active: true });
    return row.id;
  });
}

/** Closes the current notice (if any) and opens a new one, atomically. */
export async function activateDelay(db: Db, userId: number, input: unknown): Promise<Result<ActiveDelay>> {
  const parsed = activateDelaySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Revisá los datos de la demora.", fieldErrors: zodFieldErrors(parsed.error.issues) };
  }
  const { extraMinutes, reason } = parsed.data;
  try {
    try {
      await activateOnce(db, userId, extraMinutes, reason);
    } catch (err) {
      // A concurrent activation inserted its row between our close and our insert: retry once, now it is visible.
      const pg = pgError(err);
      if (pg.code !== "23505" || pg.constraint !== ONE_ACTIVE_INDEX) throw err;
      await activateOnce(db, userId, extraMinutes, reason);
    }
  } catch (err) {
    const pg = pgError(err);
    if (pg.code === "23505" && pg.constraint === ONE_ACTIVE_INDEX) {
      return { ok: false, error: "Otra persona activó una demora al mismo tiempo. Probá de nuevo." };
    }
    throw err;
  }
  const active = await getActiveDelay(db);
  if (!active) return { ok: false, error: "La demora ya fue desactivada." };
  return { ok: true, data: active };
}

export async function deactivateDelay(db: Db, userId: number): Promise<Result<{ wasActive: boolean }>> {
  const wasActive = await db.transaction(async (tx) => {
    const closed = await tx
      .update(s.delayNotices)
      .set({ endedBy: userId, endedAt: new Date() })
      .where(isNull(s.delayNotices.endedAt))
      .returning({ id: s.delayNotices.id });
    if (closed.length === 0) return false;
    await notifyInTx(tx, DELAY_CHANNEL, { active: false });
    return true;
  });
  return { ok: true, data: { wasActive } };
}
