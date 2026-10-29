import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { renderAdditionalTicket, renderCustomerTicket, renderDeliveryTicket, renderKitchenTicket, type PrintableOrder } from "@/domain/print-document";
import { PRINT_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";
import { hasDeliveryTicket, type PrintKind } from "./print-kinds";
import { orderToPrintable } from "./printable";

/** Shared by approve and reprint. No next/*; always called inside the caller's transaction. */

/**
 * Reads the order SNAPSHOT rows (4 queries) and maps them with the pure mapper. Each item carries the `seq` of its
 * add-on (null = original order); with `addonId` only that add-on's items are returned (the add-on ticket).
 */
export async function loadPrintableOrder(
  tx: DbTransaction,
  orderId: number,
  opts: { addonId?: number } = {},
): Promise<PrintableOrder | null> {
  const [order] = await tx.select().from(s.orders).where(eq(s.orders.id, orderId));
  if (!order) return null;
  const items = await tx
    .select({
      id: s.orderItems.id,
      nameSnapshot: s.orderItems.nameSnapshot,
      unitPriceSnapshot: s.orderItems.unitPriceSnapshot,
      notes: s.orderItems.notes,
      addonSeq: s.orderAddons.seq,
    })
    .from(s.orderItems)
    .leftJoin(s.orderAddons, eq(s.orderAddons.id, s.orderItems.addonId))
    .where(and(eq(s.orderItems.orderId, orderId), opts.addonId === undefined ? undefined : eq(s.orderItems.addonId, opts.addonId)))
    .orderBy(asc(s.orderItems.id));
  const modifiers = items.length
    ? await tx
        .select()
        .from(s.orderItemModifiers)
        .where(inArray(s.orderItemModifiers.orderItemId, items.map((i) => i.id)))
        .orderBy(asc(s.orderItemModifiers.id))
    : [];
  return orderToPrintable(order, items, modifiers);
}

/** Inserts the requested ticket kinds for `stationId` (pending, attempts 0) and notifies once per job. */
export async function enqueuePrintJobs(
  tx: DbTransaction,
  args: { orderId: number; stationId: number; kinds: PrintKind[]; printable: PrintableOrder },
): Promise<number[]> {
  const { orderId, stationId, kinds, printable } = args;
  // Fixed order (kitchen first, then the customer ticket, then delivery; the agent prints by job id) whatever order the caller listed them in.
  const rows: { type: PrintKind; payload: unknown }[] = [];
  if (kinds.includes("kitchen")) rows.push({ type: "kitchen", payload: renderKitchenTicket(printable) });
  if (kinds.includes("customer")) rows.push({ type: "customer", payload: renderCustomerTicket(printable) });
  if (kinds.includes("delivery")) rows.push({ type: "delivery", payload: renderDeliveryTicket(printable) });
  if (rows.length === 0) return [];

  const inserted = await tx
    .insert(s.printJobs)
    .values(rows.map((r) => ({ orderId, stationId, type: r.type, payload: r.payload, status: "pending" as const, attempts: 0 })))
    .returning({ id: s.printJobs.id });
  const ids = inserted.map((j) => j.id).sort((a, b) => a - b);
  for (const jobId of ids) await notifyInTx(tx, PRINT_CHANNEL, { jobId, stationId });
  return ids;
}

async function stationKind(tx: DbTransaction, stationId: number) {
  const [st] = await tx.select({ kind: s.stations.kind }).from(s.stations).where(eq(s.stations.id, stationId));
  return st?.kind;
}

/**
 * After an add-on is confirmed: ONE `additional` comanda (only that add-on's items) at the order's station and, for web
 * delivery orders handled at a DELIVERY station (same rule as defaultPrintKinds), the full `delivery` ticket again with the updated total (the cadet's earlier paper has the old one).
 */
export async function enqueueAddonPrintJobs(
  tx: DbTransaction,
  input: { orderId: number; addonId: number; seq: number; stationId: number; withDelivery?: boolean },
): Promise<number[]> {
  const { orderId, addonId, seq, stationId, withDelivery = true } = input;
  const addonOrder = await loadPrintableOrder(tx, orderId, { addonId });
  if (!addonOrder) throw new Error("order vanished inside transaction");
  const rows: { type: PrintKind; payload: unknown }[] = [{ type: "additional", payload: renderAdditionalTicket(addonOrder, { seq }) }];
  if (withDelivery && hasDeliveryTicket(addonOrder) && (await stationKind(tx, stationId)) === "delivery") {
    const full = await loadPrintableOrder(tx, orderId);
    rows.push({ type: "delivery", payload: renderDeliveryTicket(full!) });
  }
  const inserted = await tx
    .insert(s.printJobs)
    .values(rows.map((r) => ({ orderId, stationId, type: r.type, payload: r.payload, status: "pending" as const, attempts: 0 })))
    .returning({ id: s.printJobs.id });
  const ids = inserted.map((j) => j.id).sort((a, b) => a - b);
  for (const jobId of ids) await notifyInTx(tx, PRINT_CHANNEL, { jobId, stationId });
  return ids;
}
