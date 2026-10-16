import { asc, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Fulfillment, OrderStatus } from "@/domain/order-status";
import { hydrate, orderColumns, type PrintState } from "./caja-queries";
import type { TrackingGroup } from "./tracking-groups";

/**
 * Read side of the dispatch board (staff-facing, serializable: dates as ISO strings, money in
 * centavos). A CONSTANT number of queries however many orders there are (orders, units,
 * modifiers, cadets, cash owed), never one per order. `now` is injectable for tests. No next/*.
 */

/** One order card on the dispatch board. Carries customer address data: staff only. */
export type DispatchOrder = {
  id: number;
  /** Daily order number shown to staff (#12). */
  number: number;
  channel: "web" | "counter";
  fulfillment: Fulfillment;
  status: OrderStatus;
  paymentMethod: "cash" | "transfer";
  paymentStatus: "pending" | "paid";
  /** Centavos. */
  total: number;
  createdAt: string;
  /** Whole minutes since the order was created (never negative): the total age of the order. */
  minutesWaiting: number;
  /** ISO time the order ENTERED its current status (assignment time for en_camino, the "listo" click for listo_despacho...). */
  statusSince: string;
  /** Whole minutes in the current status (never negative): the lane clock the urgency is judged by. */
  minutesInStatus: number;
  /** First name only. */
  customerName: string | null;
  /** Delivery orders only (null for takeaway/counter). */
  address: string | null;
  crossStreets: string | null;
  addressNotes: string | null;
  /** Counter orders only: the pager (llamador) to call. */
  pagerNumber: number | null;
  /** Units grouped as in Caja, with modifier names and kitchen labels. */
  items: TrackingGroup[];
  /** Print jobs: `pending` includes jobs being printed now; `failed` only counts unhandled ones. */
  printState: PrintState;
};

/** A cadet with orders en_camino and what they carry in cash. */
export type EnRouteGroup = {
  cadet: { id: number; name: string };
  /** Oldest assignment first. */
  orders: DispatchOrder[];
  /** Centavos: sum of the totals of this group's cash orders still `pending` payment. */
  cashPending: number;
};

/** An ACTIVE cadet available for assignment. */
export type DispatchCadet = {
  id: number;
  name: string;
  phone: string | null;
  active: true;
  /** Orders currently en_camino with this cadet. */
  enRouteCount: number;
  /** Centavos owed for rendicion: delivered cash orders still `pending` payment (cadetBalance semantics). */
  cashDelivered: number;
};

export type DispatchBoard = {
  /** en_preparacion (web and counter), oldest first. */
  preparing: DispatchOrder[];
  /** listo_despacho, oldest first, split by fulfillment. */
  ready: { delivery: DispatchOrder[]; takeaway: DispatchOrder[] };
  /** para_retirar, oldest first (pager numbers are prominent on the cards). */
  pickup: DispatchOrder[];
  /** en_camino grouped by cadet, group with the oldest assignment first. */
  enRoute: EnRouteGroup[];
  /** Active cadets by name. */
  cadets: DispatchCadet[];
};

export type DispatchQueryContext = { now?: Date };

const BOARD_STATUSES: OrderStatus[] = ["en_preparacion", "listo_despacho", "para_retirar", "en_camino"];

const firstName = (name: string | null): string | null => {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
};

export async function getDispatchBoard(db: Db, ctx: DispatchQueryContext = {}): Promise<DispatchBoard> {
  const now = ctx.now ?? new Date();

  // When the order entered its CURRENT status: the latest event into that status (a return to dispatch
  // re-enters listo_despacho and resets the clock); legacy rows without such an event fall back to creation.
  const statusSince = sql<Date | string>`coalesce((select max("order_events"."at") from "order_events" where "order_events"."order_id" = "orders"."id" and "order_events"."to_status" = "orders"."status"), "orders"."created_at")`;
  const rows = await db
    .select({ ...orderColumns, cadetId: s.orders.cadetId, statusSince })
    .from(s.orders)
    .where(inArray(s.orders.status, BOARD_STATUSES))
    .orderBy(asc(s.orders.createdAt), asc(s.orders.id));
  const hydrated = await hydrate(db, rows, now);
  const meta = new Map(rows.map((r) => [r.id, { cadetId: r.cadetId, since: new Date(r.statusSince).getTime() }]));

  const toDto = (o: (typeof hydrated)[number]): DispatchOrder => ({
    id: o.id,
    number: o.number,
    channel: o.channel,
    fulfillment: o.fulfillment,
    status: o.status,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    total: o.total,
    createdAt: o.createdAt,
    minutesWaiting: o.minutesWaiting,
    statusSince: new Date(meta.get(o.id)!.since).toISOString(),
    minutesInStatus: Math.max(0, Math.floor((now.getTime() - meta.get(o.id)!.since) / 60_000)),
    customerName: firstName(o.customerName),
    address: o.fulfillment === "delivery" ? o.address : null,
    crossStreets: o.fulfillment === "delivery" ? o.crossStreets : null,
    addressNotes: o.fulfillment === "delivery" ? o.addressNotes : null,
    pagerNumber: o.pagerNumber,
    items: o.items,
    printState: o.printState,
  });

  const cadetRows = await db
    .select({ id: s.cadets.id, name: s.cadets.name, phone: s.cadets.phone, active: s.cadets.active })
    .from(s.cadets)
    .orderBy(asc(s.cadets.name), asc(s.cadets.id));
  const owedRows = await db
    .select({ cadetId: s.orders.cadetId, owed: sql<number>`coalesce(sum(${s.orders.total}), 0)::int` })
    .from(s.orders)
    .where(sql`${s.orders.status} = 'entregado' and ${s.orders.paymentMethod} = 'cash' and ${s.orders.paymentStatus} = 'pending' and ${s.orders.cadetId} is not null`)
    .groupBy(s.orders.cadetId);
  const owed = new Map(owedRows.map((r) => [r.cadetId, Number(r.owed)]));

  const board: DispatchBoard = { preparing: [], ready: { delivery: [], takeaway: [] }, pickup: [], enRoute: [], cadets: [] };
  const groups = new Map<number, { orders: { dto: DispatchOrder; at: number }[] }>();
  for (const o of hydrated) {
    const dto = toDto(o);
    if (o.status === "en_preparacion") board.preparing.push(dto);
    else if (o.status === "listo_despacho") board.ready[o.fulfillment].push(dto);
    else if (o.status === "para_retirar") board.pickup.push(dto);
    else if (o.status === "en_camino") {
      const m = meta.get(o.id)!;
      if (m.cadetId === null) continue; // en_camino without a cadet cannot happen through the cores
      const g = groups.get(m.cadetId) ?? { orders: [] };
      g.orders.push({ dto, at: m.since });
      groups.set(m.cadetId, g);
    }
  }

  const cadetById = new Map(cadetRows.map((c) => [c.id, c]));
  board.enRoute = [...groups.entries()]
    .map(([cadetId, g]) => {
      g.orders.sort((a, b) => a.at - b.at || a.dto.id - b.dto.id);
      const cadet = cadetById.get(cadetId);
      return {
        at: g.orders[0].at,
        group: {
          cadet: { id: cadetId, name: cadet?.name ?? "Cadete" },
          orders: g.orders.map((x) => x.dto),
          cashPending: g.orders
            .filter((x) => x.dto.paymentMethod === "cash" && x.dto.paymentStatus === "pending")
            .reduce((sum, x) => sum + x.dto.total, 0),
        } satisfies EnRouteGroup,
      };
    })
    .sort((a, b) => a.at - b.at || a.group.cadet.id - b.group.cadet.id)
    .map((x) => x.group);

  board.cadets = cadetRows
    .filter((c) => c.active)
    .map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      active: true as const,
      enRouteCount: groups.get(c.id)?.orders.length ?? 0,
      cashDelivered: owed.get(c.id) ?? 0,
    }));
  return board;
}
