import { asc, eq, inArray } from "drizzle-orm";
import type { DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import { renderCustomerTicket, renderKitchenTicket, type PrintableOrder } from "@/domain/print-document";
import { PRINT_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";
import { orderToPrintable } from "./printable";

/** Shared by approve and reprint. No next/*; always called inside the caller's transaction. */

export type PrintWhich = "kitchen" | "ticket" | "both";

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

/** Inserts the requested jobs for `stationId` (pending, attempts 0) and notifies once per job. */
export async function enqueuePrintJobs(
  tx: DbTransaction,
  args: { orderId: number; stationId: number; which: PrintWhich; printable: PrintableOrder },
): Promise<number[]> {
  const { orderId, stationId, which, printable } = args;
  const rows: { type: "kitchen" | "ticket"; payload: unknown }[] = [];
  if (which === "kitchen" || which === "both") rows.push({ type: "kitchen", payload: renderKitchenTicket(printable) });
  if (which === "ticket" || which === "both") rows.push({ type: "ticket", payload: renderCustomerTicket(printable) });

  const inserted = await tx
    .insert(s.printJobs)
    .values(rows.map((r) => ({ orderId, stationId, type: r.type, payload: r.payload, status: "pending" as const, attempts: 0 })))
    .returning({ id: s.printJobs.id });
  const ids = inserted.map((j) => j.id).sort((a, b) => a - b);
  for (const jobId of ids) await notifyInTx(tx, PRINT_CHANNEL, { jobId, stationId });
  return ids;
}
