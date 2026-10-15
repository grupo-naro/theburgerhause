import type { FailedPrintJob } from "@/lib/orders/caja-queries";

export type FailedWhich = "kitchen" | "ticket" | "both";
export type FailedRowModel = {
  /** Changes with the LATEST failed job, so a row's local state resets when a reprint fails again. */
  key: string;
  orderId: number;
  orderNumber: number;
  which: FailedWhich;
  jobs: FailedPrintJob[];
};

/** One row per order: both types failed -> reprint "both", otherwise just the failed one. */
export function groupFailedByOrder(jobs: FailedPrintJob[]): FailedRowModel[] {
  const byOrder = new Map<number, FailedPrintJob[]>();
  for (const j of jobs) byOrder.set(j.orderId, [...(byOrder.get(j.orderId) ?? []), j]);
  return [...byOrder.values()].map((list) => {
    const types = new Set(list.map((j) => j.type));
    const latest = Math.max(...list.map((j) => j.jobId));
    return {
      key: `${list[0].orderId}:${latest}`,
      orderId: list[0].orderId,
      orderNumber: list[0].orderNumber,
      which: types.size > 1 ? "both" : list[0].type,
      jobs: list,
    };
  });
}
