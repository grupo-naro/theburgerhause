import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { UNHANDLED_FAILED, type OrderPrintState, type PrintKindName } from "./caja-queries";

const jobCount = (filter: string) =>
  sql<number>`(select count(*)::int from "print_jobs" where "print_jobs"."order_id" = "orders"."id" and ${sql.raw(filter)})`;

/**
 * Print job counts of ONE order, with the same meaning as the Caja chips: `pending` includes jobs
 * being printed, `failed` only counts failures not superseded by a later reprint. `null` when the
 * order does not exist. No next/*.
 */
/** Distinct ticket kinds (kitchen, customer, delivery) of the order's jobs matching `filter`; legacy `ticket` reads as customer. */
async function kindsOf(db: Db, orderId: number, filter: string): Promise<PrintKindName[]> {
  const rows = await db.execute(
    sql`select distinct (case "print_jobs"."type" when 'ticket' then 'customer' else "print_jobs"."type"::text end) as kind from "print_jobs" where "print_jobs"."order_id" = ${orderId} and ${sql.raw(filter)}`,
  );
  const found = new Set((rows.rows as { kind: string }[]).map((r) => r.kind));
  return (["kitchen", "customer", "delivery"] as const).filter((k) => found.has(k));
}

export async function getOrderPrintState(db: Db, orderId: number): Promise<OrderPrintState | null> {
  const [row] = await db
    .select({
      pending: jobCount(`"print_jobs"."status" in ('pending','printing')`),
      failed: jobCount(UNHANDLED_FAILED),
      done: jobCount(`"print_jobs"."status" = 'done'`),
    })
    .from(s.orders)
    .where(eq(s.orders.id, orderId));
  if (!row) return null;
  const [failedKinds, pendingKinds] = await Promise.all([
    kindsOf(db, orderId, UNHANDLED_FAILED),
    kindsOf(db, orderId, `"print_jobs"."status" in ('pending','printing')`),
  ]);
  return { pending: row.pending, failed: row.failed, done: row.done, failedKinds, pendingKinds };
}
