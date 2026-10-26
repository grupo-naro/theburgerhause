import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Fulfillment, OrderStatus } from "@/domain/order-status";
import { groupTrackingItems, type SnapshotItem, type TrackingGroup } from "./tracking-groups";

/**
 * Customer order tracking read model. No next/*.
 *
 * The public token is a capability, so this module is deliberately paranoid:
 *  - a token of the wrong shape never reaches the database;
 *  - the DTOs are allow-lists assembled field by field (never a spread of a row), so a column
 *    added to `orders` later cannot leak. Money comes from the snapshot columns only.
 */

export const TRACKING_TOKEN = /^[0-9a-f]{32}$/;

export function isTrackingToken(value: unknown): value is string {
  return typeof value === "string" && TRACKING_TOKEN.test(value);
}

export type TrackingOrder = {
  number: number;
  status: OrderStatus;
  fulfillment: Fulfillment;
  channel: "web" | "counter";
  paymentMethod: "cash" | "transfer";
  paymentStatus: "pending" | "paid";
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601: latest entry into en_preparacion (creation time when there is none). Start of the countdown. */
  prepStartedAt: string;
  /** First word of the customer's name; the rest of it stays private. */
  firstName: string;
  /** Delivery only: the address field, nothing else (no cross streets, no notes). */
  addressLine: string | null;
  groups: TrackingGroup[];
  subtotal: number;
  deliveryFee: number;
  total: number;
};

export type TrackingStatus = {
  status: OrderStatus;
  paymentStatus: "pending" | "paid";
  /** ISO 8601: last recorded status event (creation time when there is none). */
  updatedAt: string;
};

const firstWord = (name: string | null) => (name ?? "").trim().split(/\s+/)[0] ?? "";

export async function getOrderForTracking(db: Db, token: string): Promise<TrackingOrder | null> {
  if (!isTrackingToken(token)) return null;

  // ONE query: order + unit rows + modifier snapshot rows (explicit columns: no whatsapp, no ids out).
  const rows = await db
    .select({
      number: s.orders.number,
      status: s.orders.status,
      fulfillment: s.orders.fulfillment,
      channel: s.orders.channel,
      paymentMethod: s.orders.paymentMethod,
      paymentStatus: s.orders.paymentStatus,
      createdAt: s.orders.createdAt,
      // Raw, fully qualified names (see getTrackingStatus).
      prepStartedAt: sql<Date | null>`(select max(e.at) from order_events e where e.order_id = orders.id and e.to_status = 'en_preparacion' and e.from_status is distinct from e.to_status)`.mapWith(
        (v) => (v === null ? null : new Date(v as string | Date)),
      ),
      customerName: s.orders.customerName,
      address: s.orders.address,
      subtotal: s.orders.subtotal,
      deliveryFee: s.orders.deliveryFee,
      total: s.orders.total,
      itemId: s.orderItems.id,
      productId: s.orderItems.productId,
      itemName: s.orderItems.nameSnapshot,
      itemPrice: s.orderItems.unitPriceSnapshot,
      itemNote: s.orderItems.notes,
      modifierId: s.orderItemModifiers.modifierId,
      modifierName: s.orderItemModifiers.nameSnapshot,
      modifierDelta: s.orderItemModifiers.priceDelta,
    })
    .from(s.orders)
    .leftJoin(s.orderItems, eq(s.orderItems.orderId, s.orders.id))
    .leftJoin(s.orderItemModifiers, eq(s.orderItemModifiers.orderItemId, s.orderItems.id))
    .where(eq(s.orders.publicToken, token))
    .orderBy(asc(s.orderItems.id), asc(s.orderItemModifiers.id));

  const head = rows[0];
  if (!head) return null;

  const items = new Map<number, SnapshotItem>();
  for (const r of rows) {
    if (r.itemId === null) continue;
    let item = items.get(r.itemId);
    if (!item) {
      item = { productId: r.productId, name: r.itemName!, unitPrice: r.itemPrice!, note: r.itemNote, modifiers: [] };
      items.set(r.itemId, item);
    }
    if (r.modifierName !== null) {
      item.modifiers.push({ modifierId: r.modifierId, name: r.modifierName, priceDelta: r.modifierDelta! });
    }
  }
  const { groups } = groupTrackingItems([...items.values()]);

  return {
    number: head.number,
    status: head.status,
    fulfillment: head.fulfillment,
    channel: head.channel,
    paymentMethod: head.paymentMethod,
    paymentStatus: head.paymentStatus,
    createdAt: head.createdAt.toISOString(),
    prepStartedAt: (head.prepStartedAt ?? head.createdAt).toISOString(),
    firstName: firstWord(head.customerName),
    addressLine: head.fulfillment === "delivery" ? head.address : null,
    groups,
    subtotal: head.subtotal,
    deliveryFee: head.deliveryFee,
    total: head.total,
  };
}

/** What the polling endpoint may say: three fields. Malformed tokens never reach the database. */
export async function getTrackingStatus(db: Db, token: string): Promise<TrackingStatus | null> {
  if (!isTrackingToken(token)) return null;
  const [row] = await db
    .select({
      status: s.orders.status,
      paymentStatus: s.orders.paymentStatus,
      // Raw, fully qualified names: drizzle renders bare column names inside a one-table select.
      updatedAt: sql<Date>`coalesce((select max(e.at) from order_events e where e.order_id = orders.id), orders.created_at)`.mapWith(
        (v) => new Date(v as string | Date),
      ),
    })
    .from(s.orders)
    .where(eq(s.orders.publicToken, token));
  if (!row) return null;
  return { status: row.status, paymentStatus: row.paymentStatus, updatedAt: row.updatedAt.toISOString() };
}
