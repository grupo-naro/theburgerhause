import { describe, expect, it } from "vitest";
import { nextFreePager, type ActivePager } from "@/lib/orders/pagers";
import { conflictMessage, holderOf, inUseNumbers, suggestPager } from "./pagers";

const active = (...rows: [number, number][]): ActivePager[] =>
  rows.map(([pagerNumber, orderNumber]) => ({ pagerNumber, orderNumber, orderId: orderNumber * 10, status: "en_preparacion" }));

describe("pager helpers", () => {
  const list = active([7, 23], [1, 20], [2, 21]);
  it("holderOf finds the active order holding a pager", () => {
    expect(holderOf(list, 7)).toEqual({ orderNumber: 23 });
    expect(holderOf(list, 8)).toBeNull();
    expect(holderOf(list, null)).toBeNull();
  });
  it("inUseNumbers is the plain list of numbers", () => {
    expect(inUseNumbers(list)).toEqual([7, 1, 2]);
  });
  it("conflictMessage names the order", () => {
    expect(conflictMessage(7, { orderNumber: 23 })).toBe("Llamador 7 en uso por el pedido #23");
  });
  it("suggestPager = lowest free number from the in-use list", () => {
    expect(suggestPager(list)).toBe(3);
    expect(suggestPager([])).toBe(1);
    expect(suggestPager(list)).toBe(nextFreePager(inUseNumbers(list)));
  });
  it("suggestPager returns null when all 999 are taken", () => {
    const all = Array.from({ length: 999 }, (_, i) => ({ pagerNumber: i + 1, orderNumber: i + 1, orderId: i + 1, status: "en_preparacion" }));
    expect(suggestPager(all)).toBeNull();
  });
});
