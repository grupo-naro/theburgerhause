import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";

/**
 * Read model of the counter TV (/pantalla): order NUMBERS only (never pager, name, address or amount), for counter
 * sales and web takeaway orders. A delivery order is never on it. Two zones:
 *  - preparing: en_preparacion, oldest first by when it (last) entered preparation;
 *  - ready: listo_despacho | para_retirar, oldest first by when it entered Ready (`readySince`).
 * Ages come from REAL status transitions only (`from_status IS DISTINCT FROM to_status`): a reprint writes a
 * same-status event and must not move an order. Legacy rows without events fall back to the creation time.
 * Two queries, whatever the number of orders. No next/*.
 */

type Status = (typeof s.orderStatus.enumValues)[number];

export const PREPARING_STATUSES = ["en_preparacion"] as const satisfies readonly Status[];
export const READY_STATUSES = ["listo_despacho", "para_retirar"] as const satisfies readonly Status[];

export type CounterBoard = {
  preparing: { id: number; number: number }[];
  ready: { id: number; number: number; readySince: Date }[];
};

/** Counter sales and web takeaway orders; delivery NEVER (whatever the channel). */
export const onCounterBoard = (o: { channel: "web" | "counter"; fulfillment: "delivery" | "takeaway" }): boolean => o.fulfillment === "takeaway";

/** The zone of a status, or null when the order is not on the screen. */
export function boardZone(status: Status): "preparing" | "ready" | null {
  if ((PREPARING_STATUSES as readonly Status[]).includes(status)) return "preparing";
  if ((READY_STATUSES as readonly Status[]).includes(status)) return "ready";
  return null;
}

/** Latest real transition INTO one of `to` coming from a status outside `to` (falls back to the creation time). */
const enteredAt = (to: readonly Status[]) => {
  const list = sql.join(
    to.map((t) => sql`${t}`),
    sql`, `,
  );
  return sql<Date | string>`coalesce((select max("order_events"."at") from "order_events" where "order_events"."order_id" = "orders"."id" and "order_events"."from_status" is distinct from "order_events"."to_status" and "order_events"."to_status" in (${list}) and ("order_events"."from_status" is null or "order_events"."from_status" not in (${list}))), "orders"."created_at")`;
};

/**
 * `ctx.now` is accepted for symmetry with the other read models (tests pin the clock); the board itself has no time
 * window: an order leaves only when it is delivered or cancelled.
 */
export async function getCounterBoard(db: Db, ctx: { now?: Date } = {}): Promise<CounterBoard> {
  void ctx;
  const takeaway = eq(s.orders.fulfillment, "takeaway");
  const prepSince = enteredAt(PREPARING_STATUSES);
  const readySince = enteredAt(READY_STATUSES);
  const [preparing, ready] = await Promise.all([
    db
      .select({ id: s.orders.id, number: s.orders.number })
      .from(s.orders)
      .where(and(takeaway, inArray(s.orders.status, [...PREPARING_STATUSES])))
      .orderBy(asc(prepSince), asc(s.orders.id)),
    db
      .select({ id: s.orders.id, number: s.orders.number, readySince })
      .from(s.orders)
      .where(and(takeaway, inArray(s.orders.status, [...READY_STATUSES])))
      .orderBy(asc(readySince), asc(s.orders.id)),
  ]);
  return {
    preparing: preparing.map((r) => ({ id: r.id, number: r.number })),
    ready: ready.map((r) => ({ id: r.id, number: r.number, readySince: new Date(r.readySince) })),
  };
}
