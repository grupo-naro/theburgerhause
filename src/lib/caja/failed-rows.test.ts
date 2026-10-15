import { describe, expect, it } from "vitest";
import type { FailedPrintJob } from "@/lib/orders/caja-queries";
import { groupFailedByOrder } from "./failed-rows";

const job = (jobId: number, orderId: number, type: "kitchen" | "ticket"): FailedPrintJob => ({
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
    const rows = groupFailedByOrder([job(5, 1, "kitchen"), job(6, 1, "ticket"), job(7, 2, "ticket")]);
    expect(rows.map((r) => [r.orderId, r.which])).toEqual([
      [1, "both"],
      [2, "ticket"],
    ]);
  });
  it("the key changes when the latest failed job of the order changes", () => {
    const [a] = groupFailedByOrder([job(5, 1, "kitchen")]);
    const [b] = groupFailedByOrder([job(9, 1, "kitchen")]);
    const [c] = groupFailedByOrder([job(5, 1, "kitchen")]);
    expect(a.key).not.toBe(b.key);
    expect(a.key).toBe(c.key);
  });
});
