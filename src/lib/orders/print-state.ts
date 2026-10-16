import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { UNHANDLED_FAILED, type PrintState } from "./caja-queries";

const jobCount = (filter: string) =>
  sql<number>`(select count(*)::int from "print_jobs" where "print_jobs"."order_id" = "orders"."id" and ${sql.raw(filter)})`;

/**
 * Print job counts of ONE order, with the same meaning as the Caja chips: `pending` includes jobs
 * being printed, `failed` only counts failures not superseded by a later reprint. `null` when the
 * order does not exist. No next/*.
 */
export async function getOrderPrintState(db: Db, orderId: number): Promise<PrintState | null> {
  const [row] = await db
    .select({
      pending: jobCount(`"print_jobs"."status" in ('pending','printing')`),
      failed: jobCount(UNHANDLED_FAILED),
      done: jobCount(`"print_jobs"."status" = 'done'`),
    })
    .from(s.orders)
    .where(eq(s.orders.id, orderId));
  return row ? { pending: row.pending, failed: row.failed, done: row.done } : null;
}
