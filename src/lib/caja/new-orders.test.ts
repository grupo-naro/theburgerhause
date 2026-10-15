import { describe, expect, it } from "vitest";
import { detectNewOrders } from "./new-orders";

const o = (...ids: number[]) => ids.map((id) => ({ id }));

describe("detectNewOrders(prevIds, nextOrders)", () => {
  it("the first render (no previous snapshot) never alerts", () => {
    expect(detectNewOrders(null, o(1, 2, 3))).toEqual([]);
  });
  it("an empty first snapshot followed by arrivals does alert", () => {
    expect(detectNewOrders([], o(1))).toEqual([1]);
  });
  it("one new order", () => {
    expect(detectNewOrders([1, 2], o(1, 2, 3))).toEqual([3]);
  });
  it("a reordered list is not new", () => {
    expect(detectNewOrders([1, 2, 3], o(3, 1, 2))).toEqual([]);
  });
  it("an order that was removed (approved) is not reported", () => {
    expect(detectNewOrders([1, 2], o(2))).toEqual([]);
  });
  it("ids seen before (kept in the seen set) that reappear are not new", () => {
    expect(detectNewOrders([1, 2, 3], o(1, 3))).toEqual([]);
  });
  it("duplicates in the next list are reported once", () => {
    expect(detectNewOrders([1], o(2, 2, 1, 3, 3))).toEqual([2, 3]);
  });
  it("several new at once keep the list order", () => {
    expect(detectNewOrders([1], o(5, 1, 4))).toEqual([5, 4]);
  });
  it("accepts a Set", () => {
    expect(detectNewOrders(new Set([1]), o(1, 2))).toEqual([2]);
  });
});
