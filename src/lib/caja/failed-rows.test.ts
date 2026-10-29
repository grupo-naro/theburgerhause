import { describe, expect, it } from "vitest";
import type { FailedPrintJob } from "@/lib/orders/caja-queries";
import { groupFailedByOrder } from "./failed-rows";

const job = (jobId: number, orderId: number, type: FailedPrintJob["type"]): FailedPrintJob => ({
  jobId,
  orderId,
  orderNumber: orderId + 100,
  stationId: 1,
  type,
  addonSeq: type === "additional" ? 1 : null,
  error: "x",
  attempts: 1,
  createdAt: "2026-10-15T12:00:00.000Z",
});

describe("groupFailedByOrder", () => {
  it("collects the failed add-on seqs, apart from the ordinary reprints", () => {
    const [row] = groupFailedByOrder([{ ...job(1, 1, "additional"), addonSeq: 2 }, { ...job(2, 1, "additional"), addonSeq: 1 }, job(3, 1, "customer")]);
    expect(row.addonSeqs).toEqual([1, 2]);
    expect(row.which).toEqual(["customer"]);
  });
  it("one row per order; both types failed -> reprint both", () => {
    const rows = groupFailedByOrder([job(5, 1, "delivery"), job(6, 1, "customer"), job(7, 2, "customer"), job(8, 3, "delivery"), job(10, 4, "ticket")]);
    expect(rows.map((r) => [r.orderId, r.which])).toEqual([
      [1, ["both"]],
      [2, ["customer"]],
      [3, ["delivery"]],
      [4, ["customer"]], // the legacy "ticket" rows mean "reprint the customer ticket"
    ]);
  });
  it("the kitchen comanda is its own reprint, queued first and never folded into \"both\"", () => {
    const rows = groupFailedByOrder([
      job(1, 1, "kitchen"),
      job(2, 2, "kitchen"),
      job(3, 2, "customer"),
      job(4, 3, "kitchen"),
      job(5, 3, "customer"),
      job(6, 3, "delivery"),
    ]);
    expect(rows.map((r) => [r.orderId, r.which])).toEqual([
      [1, ["kitchen"]],
      [2, ["kitchen", "customer"]],
      [3, ["kitchen", "both"]],
    ]);
  });
  it("the key changes when the latest failed job of the order changes", () => {
    const [a] = groupFailedByOrder([job(5, 1, "delivery")]);
    const [b] = groupFailedByOrder([job(9, 1, "delivery")]);
    const [c] = groupFailedByOrder([job(5, 1, "delivery")]);
    expect(a.key).not.toBe(b.key);
    expect(a.key).toBe(c.key);
  });
  it("a failed add-on ticket adds no reprint (never the customer ticket)", () => {
    const rows = groupFailedByOrder([job(1, 1, "additional"), job(2, 2, "additional"), job(3, 2, "kitchen")]);
    expect(rows.map((r) => [r.orderId, r.which])).toEqual([
      [1, []],
      [2, ["kitchen"]],
    ]);
  });
});
