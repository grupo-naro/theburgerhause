import { describe, expect, it, vi } from "vitest";
import { liveHandlers } from "./live-handlers";

describe("liveHandlers", () => {
  it("all: order, delay, stock and resync events refresh", () => {
    const refresh = vi.fn();
    expect(Object.keys(liveHandlers("all", refresh)).sort()).toEqual(["onDelay", "onOrders", "onResync", "onStock"]);
  });

  it("stock: only stock and resync refresh; order and delay events are ignored", () => {
    const refresh = vi.fn();
    const h = liveHandlers("stock", refresh);
    expect(Object.keys(h).sort()).toEqual(["onResync", "onStock"]);
    expect(h.onOrders).toBeUndefined();
    expect(h.onDelay).toBeUndefined();
    h.onStock?.({} as never);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
