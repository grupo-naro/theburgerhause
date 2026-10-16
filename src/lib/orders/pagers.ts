import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { PAGER_MAX, PAGER_MIN } from "./counter-schemas";

/** Statuses in which a counter order still holds its pager. MUST match the partial unique index. */
export const ACTIVE_PAGER_STATUSES = ["en_preparacion", "listo_despacho", "para_retirar"] as const;

export type ActivePager = { pagerNumber: number; orderId: number; orderNumber: number; status: string };

/** ONE query: the pagers held by active counter orders (same predicate as the index). */
export async function listActivePagers(db: Db): Promise<ActivePager[]> {
  const rows = await db
    .select({
      pagerNumber: s.orders.pagerNumber,
      orderId: s.orders.id,
      orderNumber: s.orders.number,
      status: s.orders.status,
    })
    .from(s.orders)
    .where(and(eq(s.orders.channel, "counter"), inArray(s.orders.status, [...ACTIVE_PAGER_STATUSES])))
    .orderBy(asc(s.orders.pagerNumber));
  return rows.map((r) => ({ ...r, pagerNumber: r.pagerNumber! }));
}

/** Lowest free pager >= `from`, wrapping after 999; null when every number is taken. Pure. */
export function nextFreePager(active: readonly number[], from: number = PAGER_MIN): number | null {
  const used = new Set(active.filter((n) => Number.isInteger(n) && n >= PAGER_MIN && n <= PAGER_MAX));
  const start = Number.isInteger(from) && from >= PAGER_MIN && from <= PAGER_MAX ? from : PAGER_MIN;
  const size = PAGER_MAX - PAGER_MIN + 1;
  for (let i = 0; i < size; i++) {
    const n = PAGER_MIN + ((start - PAGER_MIN + i) % size);
    if (!used.has(n)) return n;
  }
  return null;
}
