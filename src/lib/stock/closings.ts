import { asc, desc, eq, gte, inArray, max, sql } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { pgError } from "@/lib/orders/order-rows";
import { buenosAiresToday, CLOSING_DATE_MESSAGES } from "./closing-dates";
import { checkConsumoLines, lockKey, lockStockItems, recordMovement } from "./movements";
import type { Unit } from "./quantity";
import { closingSchema, STOCK_MESSAGES, stockFailure, validationFailure, type Result } from "./schemas";

/**
 * "Rendición de materia prima": ONE closing per date that writes the raw material used that day as
 * `consumo` movements dated to it (business_date = the closing's date, created_at = when it was
 * loaded), all in one transaction with the closing row. No next/* imports.
 * The closing stores no quantities: what it shows is always summed from its movements, so a
 * correction made in the history (editMovement, audited) is what the rendición shows.
 */

type Conn = Db | DbTransaction;
export type ClosingContext = { now?: Date };
export type CloseDayData = { closingId: number; businessDate: string };

const CLOSING_INDEXES = new Set(["stock_closings_business_date_unique", "stock_closings_idempotency_key_unique", "stock_movements_idempotency_key_unique"]);
const isClosingRace = (err: unknown) => {
  const pg = pgError(err);
  return pg.code === "23505" && pg.constraint !== undefined && CLOSING_INDEXES.has(pg.constraint);
};

const dayClosed = () => stockFailure("CONFLICT", CLOSING_DATE_MESSAGES.closed, { fieldErrors: { businessDate: CLOSING_DATE_MESSAGES.closed } });

/**
 * "Cerrar el día": closes `businessDate` (today or before, Buenos Aires) with one consumo per line
 * with an amount (blank/zero lines are ignored; at least one is required). Only active raw material.
 * A balance that would go below zero needs `confirmNegative: true`; otherwise NEEDS_CONFIRMATION
 * lists the affected items and nothing is written. A date closes once: a second closing (another
 * device, a double tap with a new key) is CONFLICT; the SAME key again returns the first result.
 */
export async function closeStockDay(
  db: Db,
  rawInput: {
    userId: number;
    businessDate: string;
    lines: { itemId: number; milli: number }[];
    idempotencyKey: string;
    confirmNegative?: boolean;
  },
  ctx: ClosingContext = {},
): Promise<Result<CloseDayData>> {
  const parsed = closingSchema.safeParse(rawInput);
  if (!parsed.success) return validationFailure(parsed.error);
  const input = parsed.data;
  const now = ctx.now ?? new Date();
  if (input.businessDate > buenosAiresToday(now)) {
    return stockFailure("VALIDATION", CLOSING_DATE_MESSAGES.future, { fieldErrors: { businessDate: CLOSING_DATE_MESSAGES.future } });
  }
  const lines = input.lines.filter((l) => l.milli > 0);
  if (lines.length === 0) return stockFailure("VALIDATION", STOCK_MESSAGES.NOTHING_TO_SAVE);
  if (new Set(lines.map((l) => l.itemId)).size !== lines.length) return stockFailure("VALIDATION", STOCK_MESSAGES.REPEATED_ITEM);

  const storedKey = `cierre:${input.idempotencyKey}`;
  // The key already closed a day: the same date is a resubmit (success, nothing written), another one a reused key.
  const replay = async (conn: Conn): Promise<Result<CloseDayData> | null> => {
    const [prev] = await conn
      .select({ id: s.stockClosings.id, businessDate: s.stockClosings.businessDate })
      .from(s.stockClosings)
      .where(eq(s.stockClosings.idempotencyKey, storedKey));
    if (!prev) return null;
    if (prev.businessDate !== input.businessDate) return stockFailure("CONFLICT", STOCK_MESSAGES.KEY_REUSED);
    return { ok: true, data: { closingId: prev.id, businessDate: prev.businessDate } };
  };
  const closedAlready = async (conn: Conn): Promise<boolean> => {
    const [row] = await conn.select({ id: s.stockClosings.id }).from(s.stockClosings).where(eq(s.stockClosings.businessDate, input.businessDate));
    return row !== undefined;
  };

  try {
    return await db.transaction(async (tx): Promise<Result<CloseDayData>> => {
      // Same key, then same date (always in this order, so two closers can never wait on each other).
      await lockKey(tx, storedKey);
      await lockKey(tx, `cierre-dia:${input.businessDate}`);
      const previous = await replay(tx);
      if (previous) return previous;
      if (await closedAlready(tx)) return dayClosed();

      const items = await lockStockItems(tx, lines.map((l) => l.itemId));
      const checked = checkConsumoLines(items, lines, ["materia_prima"]);
      if (!checked.ok) return checked.failure;
      if (checked.negatives.length > 0 && !input.confirmNegative) {
        return stockFailure("NEEDS_CONFIRMATION", STOCK_MESSAGES.NEGATIVE, { negatives: checked.negatives });
      }

      const [closing] = await tx
        .insert(s.stockClosings)
        .values({ businessDate: input.businessDate, closedBy: input.userId, closedAt: now, idempotencyKey: storedKey })
        .returning({ id: s.stockClosings.id });
      for (const line of [...lines].sort((a, b) => a.itemId - b.itemId)) {
        await recordMovement(tx, {
          item: items.get(line.itemId)!,
          kind: "consumo",
          qtyDelta: -line.milli,
          businessDate: input.businessDate,
          userId: input.userId,
          idempotencyKey: `${storedKey}:${line.itemId}`,
          closingId: closing.id,
        });
      }
      return { ok: true, data: { closingId: closing.id, businessDate: input.businessDate } };
    });
  } catch (err) {
    // The locks serialize closers, so this is only a backstop (e.g. another writer without them).
    if (isClosingRace(err)) {
      const previous = await replay(db);
      if (previous) return previous;
      if (await closedAlready(db)) return dayClosed();
    }
    throw err;
  }
}

// ---------------------------------------------------------------- reads

export type ClosingLine = { itemId: number; name: string; unit: Unit; milli: number };
export type ClosingView = { id: number; businessDate: string; closedAt: Date; closedByName: string | null; lines: ClosingLine[] };

const DEFAULT_RECENT = 2;

/**
 * Closed days, newest first: the one of `date`, or the latest `limit` (default 2). Each line is the
 * CURRENT amount used of an item (minus the sum of the closing's movements, corrections included);
 * items corrected down to zero are left out.
 */
export async function listClosings(db: Conn, opts: { date?: string; limit?: number } = {}): Promise<ClosingView[]> {
  const base = db
    .select({
      id: s.stockClosings.id,
      businessDate: s.stockClosings.businessDate,
      closedAt: s.stockClosings.closedAt,
      closedByName: s.users.name,
    })
    .from(s.stockClosings)
    .leftJoin(s.users, eq(s.users.id, s.stockClosings.closedBy));
  const closings =
    opts.date !== undefined
      ? await base.where(eq(s.stockClosings.businessDate, opts.date))
      : await base.orderBy(desc(s.stockClosings.businessDate)).limit(Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_RECENT), 1), 50));
  if (closings.length === 0) return [];

  const used = sql<number>`(-sum(${s.stockMovements.qtyDelta}))::int`;
  const rows = await db
    .select({ closingId: s.stockMovements.closingId, itemId: s.stockItems.id, name: s.stockItems.name, unit: s.stockItems.unit, milli: used })
    .from(s.stockMovements)
    .innerJoin(s.stockItems, eq(s.stockItems.id, s.stockMovements.itemId))
    .where(inArray(s.stockMovements.closingId, closings.map((c) => c.id)))
    .groupBy(s.stockMovements.closingId, s.stockItems.id)
    .orderBy(asc(sql`lower(${s.stockItems.name})`), asc(s.stockItems.id));
  const byClosing = new Map<number, ClosingLine[]>();
  for (const { closingId, milli, ...line } of rows) {
    if (closingId === null || Number(milli) === 0) continue;
    byClosing.set(closingId, [...(byClosing.get(closingId) ?? []), { ...line, milli: Number(milli) }]);
  }
  return closings.map((c) => ({ ...c, lines: byClosing.get(c.id) ?? [] }));
}

/** Dates closed on or after `since` (YYYY-MM-DD), for the date picker. */
export async function listClosedDates(db: Conn, since: string): Promise<string[]> {
  const rows = await db
    .select({ d: s.stockClosings.businessDate })
    .from(s.stockClosings)
    .where(gte(s.stockClosings.businessDate, since))
    .orderBy(desc(s.stockClosings.businessDate));
  return rows.map((r) => r.d);
}

/** The latest closed date, or null when none was ever closed. */
export async function lastClosedDate(db: Conn): Promise<string | null> {
  const [row] = await db.select({ d: max(s.stockClosings.businessDate) }).from(s.stockClosings);
  return row?.d ?? null;
}
