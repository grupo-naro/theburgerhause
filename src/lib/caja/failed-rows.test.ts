import { describe, expect, it } from "vitest";
import type { FailedPrintJob } from "@/lib/orders/caja-queries";
import { groupFailedByOrder } from "./failed-rows";

const job = (jobId: number, orderId: number, type: FailedPrintJob["type"]): FailedPrintJob => ({
  jobId,
  orderId,
  orderNumber: orderId + 100,
  stationId: 1,
  type,
  error: "x",
  attempts: 1,
  createdAt: "2026-10-15T12:00:00.000Z",
});

describe("groupFailedByOrder", () => {
  it("one row per order; both types failed -> reprint both", () => {
    const rows = groupFailedByOrder([job(5, 1, "delivery"), job(6, 1, "customer"), job(7, 2, "customer"), job(8, 3, "delivery"), job(9, 4, "kitchen"), job(10, 4, "ticket")]);
    expect(rows.map((r) => [r.orderId, r.which])).toEqual([
      [1, "both"],
      [2, "customer"],
      [3, "delivery"],
      [4, "customer"], // legacy kitchen + ticket rows both mean "reprint the customer ticket"
    ]);
  });
  it("the key changes when the latest failed job of the order changes", () => {
    const [a] = groupFailedByOrder([job(5, 1, "delivery")]);
    const [b] = groupFailedByOrder([job(9, 1, "delivery")]);
    const [c] = groupFailedByOrder([job(5, 1, "delivery")]);
    expect(a.key).not.toBe(b.key);
    expect(a.key).toBe(c.key);
  });
});
