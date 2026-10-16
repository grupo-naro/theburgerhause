import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, type Db } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { listActivePagers } from "./pagers";

const db = () => testDb();
let seq = 0;
const order = (over: Partial<typeof s.orders.$inferInsert>): typeof s.orders.$inferInsert => {
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
    pagerNumber: 1,
    subtotal: 1,
    total: 1,
    ...over,
  };
};

beforeEach(resetDb);
afterAll(closeDb);

describe("listActivePagers", () => {
  it("returns only ACTIVE counter orders, ordered by pager; excludes web, entregado and cancelado", async () => {
    await db().insert(s.orders).values([
      order({ pagerNumber: 30, status: "para_retirar" }),
      order({ pagerNumber: 5 }),
      order({ pagerNumber: 12, status: "listo_despacho" }),
      order({ pagerNumber: 6, status: "entregado" }),
      order({ pagerNumber: 6, status: "cancelado" }),
      order({ pagerNumber: null, channel: "web", status: "en_preparacion", customerName: "Ana" }),
      order({ pagerNumber: 9, channel: "web", status: "en_preparacion", customerName: "Ana" }),
    ]);
    const rows = await db().select({ id: s.orders.id, number: s.orders.number, pager: s.orders.pagerNumber }).from(s.orders);
    const list = await listActivePagers(db());
    expect(list.map((p) => [p.pagerNumber, p.status])).toEqual([
      [5, "en_preparacion"],
      [12, "listo_despacho"],
      [30, "para_retirar"],
    ]);
    for (const p of list) {
      const [o] = rows.filter((r) => r.id === p.orderId);
      expect(o.number).toBe(p.orderNumber);
      expect(o.pager).toBe(p.pagerNumber);
    }
  });

  it("is empty when nothing is active", async () => {
    expect(await listActivePagers(db())).toEqual([]);
  });

  it("issues exactly ONE query", async () => {
    await db().insert(s.orders).values(order({ pagerNumber: 4 }));
    let selects = 0;
    const counting = new Proxy(db(), {
      get(target, prop, receiver) {
        if (prop === "select") selects += 1;
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as Db;
    const list = await listActivePagers(counting);
    expect(list).toHaveLength(1);
    expect(selects).toBe(1);
  });
});
