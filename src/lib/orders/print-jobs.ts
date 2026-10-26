import { asc, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { renderCustomerTicket, renderDeliveryTicket, renderKitchenTicket, type PrintableOrder } from "@/domain/print-document";
import { PRINT_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";
import type { PrintKind } from "./print-kinds";
import { orderToPrintable } from "./printable";

/** Shared by approve and reprint. No next/*; always called inside the caller's transaction. */

/** Reads the order SNAPSHOT rows (3 queries) and maps them with the pure mapper. */
export async function loadPrintableOrder(tx: DbTransaction, orderId: number): Promise<PrintableOrder | null> {
  const [order] = await tx.select().from(s.orders).where(eq(s.orders.id, orderId));
  if (!order) return null;
  const items = await tx.select().from(s.orderItems).where(eq(s.orderItems.orderId, orderId)).orderBy(asc(s.orderItems.id));
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
