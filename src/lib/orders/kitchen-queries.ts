import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";

/**
 * Read model of the kitchen screen (KDS): orders in preparation as cards, plus the "Recién listos" strip.
 * Staff-facing and serializable-friendly; carries NO customer data (the kitchen needs none) and no money.
 * A CONSTANT number of queries however many orders there are. No next/*.
 */

export type KitchenType = "delivery" | "mostrador" | "retiro";

export type KitchenUnit = {
  /** 1-based position inside the order (one order_items row per unit). */
  n: number;
  productName: string;
  /** Kitchen labels of the unit's modifiers, uppercase as the old kitchen ticket printed them. */
  lines: string[];
};

export type KitchenCard = {
  id: number;
  /** Daily order number shown to staff (#12). */
  number: number;
  type: KitchenType;
  /** Pager (llamador) of a counter sale, null otherwise. */
  pager: number | null;
  /** When the order ENTERED the kitchen (first approval into en_preparacion; creation time for legacy rows without the event). For "Recién listos": when it was marked ready. */
  since: Date;
  units: KitchenUnit[];
  /** Customer notes of the units as plain text (rendered as text only): the single note, or "Unidad N: ..." lines. */
  note: string | null;
};

const DEFAULT_RECENT = 6;
const MAX_RECENT = 20;

export const kitchenTypeOf = (o: { fulfillment: "delivery" | "takeaway"; channel: "web" | "counter" }): KitchenType =>
  o.fulfillment === "delivery" ? "delivery" : o.channel === "counter" ? "mostrador" : "retiro";

type Row = {
  id: number;
  number: number;
  fulfillment: "delivery" | "takeaway";
  channel: "web" | "counter";
  pagerNumber: number | null;
  since: Date | string;
};

const eventAt = (agg: "min" | "max", status: string) =>
  sql<Date | string>`coalesce((select ${sql.raw(agg)}("order_events"."at") from "order_events" where "order_events"."order_id" = "orders"."id" and "order_events"."to_status" = ${status} and "order_events"."from_status" is distinct from "order_events"."to_status"), "orders"."created_at")`;

async function toCards(db: Db, rows: Row[]): Promise<KitchenCard[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const units = await db
    .select({ id: s.orderItems.id, orderId: s.orderItems.orderId, name: s.orderItems.nameSnapshot, note: s.orderItems.notes })
    .from(s.orderItems)
    .where(inArray(s.orderItems.orderId, ids))
    .orderBy(asc(s.orderItems.id));
  const mods = units.length
    ? await db
        .select({ itemId: s.orderItemModifiers.orderItemId, kitchenLabel: s.orderItemModifiers.kitchenLabel })
        .from(s.orderItemModifiers)
        .where(inArray(s.orderItemModifiers.orderItemId, units.map((u) => u.id)))
        .orderBy(asc(s.orderItemModifiers.id))
    : [];
  const labels = new Map<number, string[]>();
  for (const m of mods) labels.set(m.itemId, [...(labels.get(m.itemId) ?? []), m.kitchenLabel.toUpperCase()]);

  const byOrder = new Map<number, typeof units>();
  for (const u of units) byOrder.set(u.orderId, [...(byOrder.get(u.orderId) ?? []), u]);

  return rows.map((r) => {
    const list = byOrder.get(r.id) ?? [];
    const noted = list.map((u, i) => ({ n: i + 1, note: u.note?.trim() ?? "" })).filter((x) => x.note !== "");
    const note = noted.length === 0 ? null : list.length === 1 ? noted[0].note : noted.map((x) => `Unidad ${x.n}: ${x.note}`).join("\n");
    return {
      id: r.id,
      number: r.number,
      type: kitchenTypeOf(r),
      pager: r.pagerNumber,
      since: new Date(r.since),
      units: list.map((u, i) => ({ n: i + 1, productName: u.name, lines: labels.get(u.id) ?? [] })),
      note,
    };
  });
}

/** Orders en_preparacion, the one that entered the kitchen first on top. Cancelled / ready orders are simply not there. */
export async function listKitchenBoard(db: Db): Promise<KitchenCard[]> {
  const since = eventAt("min", "en_preparacion");
  const rows = await db
    .select({ id: s.orders.id, number: s.orders.number, fulfillment: s.orders.fulfillment, channel: s.orders.channel, pagerNumber: s.orders.pagerNumber, since })
    .from(s.orders)
    .where(eq(s.orders.status, "en_preparacion"))
    .orderBy(asc(since), asc(s.orders.id));
  return toCards(db, rows);
}

/**
 * Orders marked ready that nobody acted on yet: still listo_despacho (a called pager is para_retirar, an assigned one
 * en_camino) and no cadet. Newest first; these are the ones "Volver a preparación" still applies to.
 */
export async function listRecentlyReady(db: Db, opts: { limit?: number } = {}): Promise<KitchenCard[]> {
  const requested = Number.isFinite(opts.limit) ? Math.trunc(opts.limit as number) : DEFAULT_RECENT;
  const limit = Math.min(MAX_RECENT, Math.max(1, requested));
  const since = eventAt("max", "listo_despacho");
  const where: SQL | undefined = and(eq(s.orders.status, "listo_despacho"), isNull(s.orders.cadetId));
  const rows = await db
    .select({ id: s.orders.id, number: s.orders.number, fulfillment: s.orders.fulfillment, channel: s.orders.channel, pagerNumber: s.orders.pagerNumber, since })
    .from(s.orders)
    .where(where)
    .orderBy(desc(since), desc(s.orders.id))
    .limit(limit);
  return toCards(db, rows);
}
