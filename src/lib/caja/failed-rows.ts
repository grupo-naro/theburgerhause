import type { FailedPrintJob } from "@/lib/orders/caja-queries";
import type { PrintWhich } from "@/lib/orders/print-kinds";
import { reprintsFor } from "./reprint-queue";

/** The reprint a failed job calls for: its own ticket kind (the legacy `ticket` rows are customer tickets). */
const whichOf = (type: FailedPrintJob["type"]): "kitchen" | "customer" | "delivery" =>
  type === "kitchen" ? "kitchen" : type === "delivery" ? "delivery" : "customer";

export type FailedRowModel = {
  /** Changes with the LATEST failed job, so a row's local state resets when a reprint fails again. */
  key: string;
  orderId: number;
  orderNumber: number;
  /** Reprints to queue, in this order: the kitchen comanda (if it failed) first, then customer / delivery / both. */
  which: PrintWhich[]; // empty = nothing reprintable from here (e.g. only a failed add-on ticket)
  jobs: FailedPrintJob[];
  /** Add-on seqs whose ticket failed (ascending): each is reprinted on its own with reprintAddonAction. */
  addonSeqs: number[];
};

/** One row per order: customer + delivery both failed -> reprint "both"; the kitchen comanda is reprinted on its own. */
export function groupFailedByOrder(jobs: FailedPrintJob[]): FailedRowModel[] {
  const byOrder = new Map<number, FailedPrintJob[]>();
  for (const j of jobs) byOrder.set(j.orderId, [...(byOrder.get(j.orderId) ?? []), j]);
  return [...byOrder.values()].map((list) => {
    // Add-on tickets are not reprintable through reprintOrder (they need the add-on seq): they add no `which`.
    const kinds = new Set(list.filter((j) => j.type !== "additional").map((j) => whichOf(j.type)));
    const latest = Math.max(...list.map((j) => j.jobId));
    const which: PrintWhich[] = reprintsFor(kinds);
    return {
      key: `${list[0].orderId}:${latest}`,
      orderId: list[0].orderId,
      orderNumber: list[0].orderNumber,
      which,
      jobs: list,
      addonSeqs: [...new Set(list.flatMap((j) => (j.type === "additional" && j.addonSeq !== null ? [Number(j.addonSeq)] : [])))].sort((a, b) => a - b),
    };
  });
}
