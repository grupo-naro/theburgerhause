import type { FailedPrintJob } from "@/lib/orders/caja-queries";
import type { PrintWhich } from "@/lib/orders/print-kinds";

/** The reprint a failed job calls for: its own ticket kind (the legacy `ticket` rows are customer tickets). */
const whichOf = (type: FailedPrintJob["type"]): "kitchen" | "customer" | "delivery" =>
  type === "kitchen" ? "kitchen" : type === "delivery" ? "delivery" : "customer";

export type FailedRowModel = {
  /** Changes with the LATEST failed job, so a row's local state resets when a reprint fails again. */
  key: string;
  orderId: number;
  orderNumber: number;
  /** Reprints to queue, in this order: the kitchen comanda (if it failed) first, then customer / delivery / both. */
  which: PrintWhich[];
  jobs: FailedPrintJob[];
};

/** One row per order: customer + delivery both failed -> reprint "both"; the kitchen comanda is reprinted on its own. */
export function groupFailedByOrder(jobs: FailedPrintJob[]): FailedRowModel[] {
  const byOrder = new Map<number, FailedPrintJob[]>();
  for (const j of jobs) byOrder.set(j.orderId, [...(byOrder.get(j.orderId) ?? []), j]);
  return [...byOrder.values()].map((list) => {
    const kinds = new Set(list.map((j) => whichOf(j.type)));
    const latest = Math.max(...list.map((j) => j.jobId));
    const tickets = (["customer", "delivery"] as const).filter((k) => kinds.has(k));
    const which: PrintWhich[] = [...(kinds.has("kitchen") ? (["kitchen"] as const) : []), ...(tickets.length > 1 ? (["both"] as const) : tickets)];
    return {
      key: `${list[0].orderId}:${latest}`,
      orderId: list[0].orderId,
      orderNumber: list[0].orderNumber,
      which,
      jobs: list,
    };
  });
}
