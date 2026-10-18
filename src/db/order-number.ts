import { sql } from "drizzle-orm";
import type { DbTransaction } from "@/db/client";

const BUSINESS_TZ = "America/Argentina/Buenos_Aires";
const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const DEFAULT_BUSINESS_DAY_CUTOFF = "06:00";
const CUTOFF_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" -> minutes after midnight, or null when malformed. Pure. */
export function cutoffMinutes(cutoff: string): number | null {
  const m = CUTOFF_RE.exec(cutoff);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Business day (YYYY-MM-DD) for the given instant: the Buenos Aires calendar day of the instant
 * shifted back by the cutoff ("HH:MM", default 06:00). A sale at 23:50 and one at 00:05 are the same
 * business day; the day (and the order numbering) rolls over at the cutoff. Pure. A malformed cutoff
 * falls back to the default.
 */
export function businessDateFor(d: Date, cutoff: string = DEFAULT_BUSINESS_DAY_CUTOFF): string {
  const minutes = cutoffMinutes(cutoff) ?? (cutoffMinutes(DEFAULT_BUSINESS_DAY_CUTOFF) as number);
  return dateFormat.format(new Date(d.getTime() - minutes * 60_000));
}

/**
 * Next correlative order number for a business date. Single atomic upsert:
 * concurrent transactions serialize on the counter row, so numbers are unique
 * and gap-free per day as long as the caller's transaction commits.
 */
export async function nextOrderNumber(tx: DbTransaction, businessDate: string): Promise<number> {
  const result = await tx.execute<{ last_number: number }>(sql`
    INSERT INTO daily_counters (business_date, last_number)
    VALUES (${businessDate}, 1)
    ON CONFLICT (business_date)
    DO UPDATE SET last_number = daily_counters.last_number + 1
    RETURNING last_number
  `);
  return result.rows[0].last_number;
}
