import { sql } from "drizzle-orm";
import type { DbTransaction } from "@/db/client";

const BUSINESS_TZ = "America/Argentina/Buenos_Aires";
const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar day (YYYY-MM-DD) in Buenos Aires for the given instant. Pure. */
export function businessDateFor(d: Date): string {
  return dateFormat.format(d);
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
