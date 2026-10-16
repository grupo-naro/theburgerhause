import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";

const db = () => testDb();

async function pgCode(promise: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    let e: unknown = err;
    while (e) {
      const code = (e as { code?: unknown }).code;
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
      e = (e as { cause?: unknown }).cause;
    }
    return "unknown";
  }
  return undefined;
}
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";

let seq = 0;
async function makeOrder() {
  seq += 1;
  const [o] = await db()
    .insert(s.orders)
    .values({
      businessDate: "2026-10-14",
      number: seq,
      publicToken: `st-${seq}-${Math.random()}`,
      channel: "web",
      fulfillment: "delivery",
      status: "entregado",
      paymentMethod: "cash",
      paymentStatus: "pending",
      customerName: "Cliente",
      subtotal: 1000,
      deliveryFee: 0,
      total: 1000,
    })
    .returning();
  return o;
}
async function makeSettlement(over: Partial<typeof s.settlements.$inferInsert> = {}) {
  const [c] = await db().insert(s.cadets).values({ name: "Nahuel" }).returning();
  const [st] = await db()
    .insert(s.settlements)
    .values({ cadetId: c.id, amount: 1000, receivedAmount: 1000, ...over })
    .returning();
  return { cadet: c, settlement: st };
}

beforeEach(resetDb);
afterAll(closeDb);

describe("settlements constraints", () => {
  it("amount must be positive", async () => {
    const [c] = await db().insert(s.cadets).values({ name: "Nahuel" }).returning();
    for (const amount of [0, -1]) {
      expect(await pgCode(db().insert(s.settlements).values({ cadetId: c.id, amount, receivedAmount: 0 })), String(amount)).toBe(CHECK_VIOLATION);
    }
    await expect(db().insert(s.settlements).values({ cadetId: c.id, amount: 1, receivedAmount: 1 })).resolves.toBeDefined();
  });

  it("note is optional and capped at 200 characters", async () => {
    const [c] = await db().insert(s.cadets).values({ name: "Nahuel" }).returning();
    await expect(db().insert(s.settlements).values({ cadetId: c.id, amount: 5, receivedAmount: 5, note: null })).resolves.toBeDefined();
    await expect(db().insert(s.settlements).values({ cadetId: c.id, amount: 5, receivedAmount: 5, note: "a".repeat(200) })).resolves.toBeDefined();
    expect(await pgCode(db().insert(s.settlements).values({ cadetId: c.id, amount: 5, receivedAmount: 5, note: "a".repeat(201) }))).toBe(CHECK_VIOLATION);
  });
});

describe("settlements received_amount", () => {
  it("is required, never negative and never above the debt cleared", async () => {
    const [c] = await db().insert(s.cadets).values({ name: "Nahuel" }).returning();
    const ins = (receivedAmount: number | null) =>
      db().insert(s.settlements).values({ cadetId: c.id, amount: 1000, receivedAmount: receivedAmount as number });
    expect(await pgCode(ins(null))).toBe("23502");
    expect(await pgCode(ins(-1))).toBe(CHECK_VIOLATION);
    expect(await pgCode(ins(1001))).toBe(CHECK_VIOLATION);
    await expect(ins(0)).resolves.toBeDefined();
    await expect(ins(999)).resolves.toBeDefined();
    await expect(ins(1000)).resolves.toBeDefined();
  });
});

describe("settlement_orders constraints", () => {
  it("amount may be zero but not negative", async () => {
    const { settlement } = await makeSettlement();
    const [a, b] = [await makeOrder(), await makeOrder()];
    expect(await pgCode(db().insert(s.settlementOrders).values({ settlementId: settlement.id, orderId: a.id, amount: -1 }))).toBe(CHECK_VIOLATION);
    await expect(db().insert(s.settlementOrders).values({ settlementId: settlement.id, orderId: b.id, amount: 0 })).resolves.toBeDefined();
  });

  it("an order can be settled at most once, even by a different settlement (23505)", async () => {
    const { cadet, settlement } = await makeSettlement();
    const [second] = await db().insert(s.settlements).values({ cadetId: cadet.id, amount: 1000, receivedAmount: 1000 }).returning();
    const o = await makeOrder();
    await db().insert(s.settlementOrders).values({ settlementId: settlement.id, orderId: o.id, amount: 1000 });
    expect(await pgCode(db().insert(s.settlementOrders).values({ settlementId: second.id, orderId: o.id, amount: 1000 }))).toBe(UNIQUE_VIOLATION);
  });
});
