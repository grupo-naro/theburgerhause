import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";

const db = () => testDb();

async function pgCode(promise: PromiseLike<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await promise;
  } catch (err) {
    let e: unknown = err;
    while (e) {
      const code = (e as { code?: unknown }).code;
      if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
        return { code, constraint: (e as { constraint?: string }).constraint };
      }
      e = (e as { cause?: unknown }).cause;
    }
    return { code: "unknown" };
  }
  return {};
}

let seq = 0;
function counter(over: Partial<typeof s.orders.$inferInsert> = {}): typeof s.orders.$inferInsert {
  seq += 1;
  return {
    businessDate: "2026-10-14",
    number: seq,
    publicToken: `tok-${seq}-${Math.random()}`,
    channel: "counter",
    fulfillment: "takeaway",
    status: "en_preparacion",
    paymentMethod: "cash",
    paymentStatus: "paid",
    customerName: null,
    pagerNumber: 7,
    subtotal: 1000,
    deliveryFee: 0,
    total: 1000,
    ...over,
  };
}

beforeEach(resetDb);
afterAll(closeDb);

describe("orders_active_counter_pager_unique", () => {
  it("two ACTIVE counter orders with the same pager violate the index (23505)", async () => {
    await db().insert(s.orders).values(counter());
    const r = await pgCode(db().insert(s.orders).values(counter({ status: "listo_despacho" })));
    expect(r).toEqual({ code: "23505", constraint: "orders_active_counter_pager_unique" });
    expect((await pgCode(db().insert(s.orders).values(counter({ status: "para_retirar" })))).code).toBe("23505");
  });

  it("the pager is free once the first order is entregado or cancelado", async () => {
    const [a] = await db().insert(s.orders).values(counter()).returning();
    await db().update(s.orders).set({ status: "entregado" }).where(eq(s.orders.id, a.id));
    const [b] = await db().insert(s.orders).values(counter()).returning();
    expect(b.id).not.toBe(a.id);
    await db().update(s.orders).set({ status: "cancelado" }).where(eq(s.orders.id, b.id));
    expect((await pgCode(db().insert(s.orders).values(counter()))).code).toBeUndefined();
  });

  it("closed orders can share a pager with each other", async () => {
    expect((await pgCode(db().insert(s.orders).values(counter({ status: "entregado" })))).code).toBeUndefined();
    expect((await pgCode(db().insert(s.orders).values(counter({ status: "entregado" })))).code).toBeUndefined();
    expect((await pgCode(db().insert(s.orders).values(counter({ status: "cancelado" })))).code).toBeUndefined();
  });

  it("different pagers coexist; web orders (pager NULL) are unaffected", async () => {
    const web = (): typeof s.orders.$inferInsert =>
      counter({ channel: "web", status: "pendiente_aprobacion", paymentStatus: "pending", pagerNumber: null, customerName: "Ana" });
    await db().insert(s.orders).values([counter({ pagerNumber: 1 }), counter({ pagerNumber: 2 }), web(), web(), web()]);
    expect(await db().select().from(s.orders)).toHaveLength(5);
  });

  it("a web order never collides with a counter pager even if it carried one", async () => {
    await db().insert(s.orders).values(counter());
    const r = await pgCode(
      db().insert(s.orders).values(counter({ channel: "web", status: "en_preparacion", customerName: "Ana" })),
    );
    expect(r.code).toBeUndefined();
  });
});

describe("orders_pager_range", () => {
  it.each([0, -1, 1000])("pager %i violates the CHECK (23514)", async (n) => {
    expect((await pgCode(db().insert(s.orders).values(counter({ pagerNumber: n })))).code).toBe("23514");
  });
  it.each([1, 999])("pager %i is accepted", async (n) => {
    expect((await pgCode(db().insert(s.orders).values(counter({ pagerNumber: n })))).code).toBeUndefined();
  });
});

describe("orders.customer_name", () => {
  it("is nullable (counter sales may be anonymous)", async () => {
    const [o] = await db().insert(s.orders).values(counter()).returning();
    expect(o.customerName).toBeNull();
  });
});
