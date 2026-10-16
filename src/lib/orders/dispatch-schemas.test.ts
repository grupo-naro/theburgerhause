import { describe, expect, it } from "vitest";
import {
  assignCadetInputSchema,
  markDeliveredInputSchema,
  orderIdInputSchema,
  returnToDispatchInputSchema,
} from "./dispatch-schemas";

const INT4 = 2_147_483_647;

describe("orderIdInputSchema", () => {
  it.each([1, INT4])("accepts %d", (orderId) => expect(orderIdInputSchema.safeParse({ orderId, userId: 1 }).success).toBe(true));
  it.each([0, -1, 1.5, INT4 + 1, "1", null, undefined, NaN])("rejects orderId %j", (orderId) =>
    expect(orderIdInputSchema.safeParse({ orderId, userId: 1 }).success).toBe(false),
  );
  it("rejects a bad userId and strips unknown keys", () => {
    expect(orderIdInputSchema.safeParse({ orderId: 1, userId: 0 }).success).toBe(false);
    expect(orderIdInputSchema.parse({ orderId: 1, userId: 2, total: 5 })).toEqual({ orderId: 1, userId: 2 });
  });
});

describe("markDeliveredInputSchema", () => {
  it("collected is an optional strict boolean", () => {
    expect(markDeliveredInputSchema.parse({ orderId: 1, userId: 1 })).toEqual({ orderId: 1, userId: 1 });
    expect(markDeliveredInputSchema.parse({ orderId: 1, userId: 1, collected: true }).collected).toBe(true);
    expect(markDeliveredInputSchema.safeParse({ orderId: 1, userId: 1, collected: "true" }).success).toBe(false);
    expect(markDeliveredInputSchema.safeParse({ orderId: 1, userId: 1, collected: 1 }).success).toBe(false);
  });
});

describe("returnToDispatchInputSchema", () => {
  const ok = (reason: unknown) => returnToDispatchInputSchema.safeParse({ orderId: 1, userId: 1, reason });
  it("cleans the reason", () => {
    const r = ok("  Nadie\u0000 atendió‮\nel timbre ");
    expect(r.success && r.data.reason).toBe("Nadie atendió el timbre");
  });
  it.each(["", "  ", "ab", "x".repeat(201), 5, null, undefined])("rejects reason %j", (reason) => expect(ok(reason).success).toBe(false));
  it("accepts 3 and 200 chars", () => {
    expect(ok("abc").success).toBe(true);
    expect(ok("x".repeat(200)).success).toBe(true);
  });
});

describe("assignCadetInputSchema", () => {
  const parse = (orderIds: unknown, cadetId: unknown = 1) => assignCadetInputSchema.safeParse({ orderIds, cadetId, userId: 1 });
  const withCadet = (cadetId: unknown) => assignCadetInputSchema.safeParse({ orderIds: [1], cadetId, userId: 1 });
  it("de-duplicates preserving first occurrence order", () => {
    const r = parse([3, 1, 3, 2, 1]);
    expect(r.success && r.data.orderIds).toEqual([3, 1, 2]);
  });
  it("accepts 1 and 50 ids, rejects 0 and 51", () => {
    expect(parse([1]).success).toBe(true);
    expect(parse(Array.from({ length: 50 }, (_, i) => i + 1)).success).toBe(true);
    expect(parse([]).success).toBe(false);
    expect(parse(Array.from({ length: 51 }, (_, i) => i + 1)).success).toBe(false);
  });
  it.each([[[0]], [[-1]], [[1.5]], [[INT4 + 1]], [["1"]], ["1"], [null]])("rejects ids %j", (ids) => expect(parse(ids).success).toBe(false));
  it.each([0, -1, 1.5, INT4 + 1, "1", null, undefined])("rejects cadetId %j", (c) => expect(withCadet(c).success).toBe(false));
  it("strips unknown keys", () => {
    expect(assignCadetInputSchema.parse({ orderIds: [1], cadetId: 2, userId: 3, total: 9 })).toEqual({ orderIds: [1], cadetId: 2, userId: 3 });
  });
});
