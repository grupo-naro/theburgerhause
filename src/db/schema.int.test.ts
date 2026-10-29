import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { nextOrderNumber } from "@/db/order-number";
import * as s from "@/db/schema";
import { seed } from "@/db/seed";
import { resetDb, testDb } from "@/db/test-utils";

const db = () => testDb();

/** Postgres SQLSTATE of a (possibly drizzle-wrapped) driver error. */
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
const FK_VIOLATION = "23503";

let seq = 0;
function orderValues(
  over: Partial<typeof s.orders.$inferInsert> = {},
): typeof s.orders.$inferInsert {
  seq += 1;
  return {
    businessDate: "2026-10-14",
    number: seq,
    publicToken: `tok-${seq}-${Math.random()}`,
    channel: "web",
    fulfillment: "takeaway",
    status: "pendiente_aprobacion",
    paymentMethod: "cash",
    paymentStatus: "pending",
    customerName: "Cliente",
    subtotal: 1000,
    deliveryFee: 0,
    total: 1000,
    ...over,
  };
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeDb();
});

describe("nextOrderNumber", () => {
  it("yields 1..20 with no duplicates for 20 parallel transactions on one date", async () => {
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () => db().transaction((tx) => nextOrderNumber(tx, "2026-10-14"))),
    );
    expect([...numbers].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it("restarts at 1 for a new date", async () => {
    await db().transaction((tx) => nextOrderNumber(tx, "2026-10-14"));
    await db().transaction((tx) => nextOrderNumber(tx, "2026-10-14"));
    const other = await db().transaction((tx) => nextOrderNumber(tx, "2026-10-15"));
    expect(other).toBe(1);
  });
});

describe("orders constraints", () => {
  it("rejects a counter order without pager_number, accepts it with one", async () => {
    const code = await pgCode(
      db().insert(s.orders).values(orderValues({ channel: "counter", pagerNumber: null })),
    );
    expect(code).toBe(CHECK_VIOLATION);
    await expect(
      db().insert(s.orders).values(orderValues({ channel: "counter", pagerNumber: 7 })),
    ).resolves.toBeDefined();
  });

  it("rejects a web order without customer_name (23514), accepts a counter order without one", async () => {
    for (const channel of ["web"] as const) {
      const code = await pgCode(
        db().insert(s.orders).values(orderValues({ channel, customerName: null })),
      );
      expect(code, channel).toBe(CHECK_VIOLATION);
    }
    await expect(
      db().insert(s.orders).values(orderValues({ channel: "counter", pagerNumber: 7, customerName: null })),
    ).resolves.toBeDefined();
    await expect(
      db().insert(s.orders).values(orderValues({ channel: "web", customerName: "Ana" })),
    ).resolves.toBeDefined();
  });

  it("rejects a duplicate (business_date, number)", async () => {
    await db().insert(s.orders).values(orderValues({ number: 1 }));
    const code = await pgCode(db().insert(s.orders).values(orderValues({ number: 1 })));
    expect(code).toBe(UNIQUE_VIOLATION);
    // same number on another date is fine
    await expect(
      db().insert(s.orders).values(orderValues({ number: 1, businessDate: "2026-10-15" })),
    ).resolves.toBeDefined();
  });

  it("rejects a negative total", async () => {
    const code = await pgCode(db().insert(s.orders).values(orderValues({ total: -1 })));
    expect(code).toBe(CHECK_VIOLATION);
  });

  it("rejects a repeated non-null idempotency_key but allows many NULLs", async () => {
    await db().insert(s.orders).values(orderValues({ idempotencyKey: "k1" }));
    const code = await pgCode(db().insert(s.orders).values(orderValues({ idempotencyKey: "k1" })));
    expect(code).toBe(UNIQUE_VIOLATION);
    await db().insert(s.orders).values(orderValues({ idempotencyKey: null }));
    await expect(
      db().insert(s.orders).values(orderValues({ idempotencyKey: null })),
    ).resolves.toBeDefined();
  });
});

describe("modifiers constraints", () => {
  it("rejects a remove modifier with a non-zero price_delta", async () => {
    const [group] = await db().insert(s.modifierGroups).values({ name: "G" }).returning();
    const base = { groupId: group.id, name: "Sin X", kitchenLabel: "SIN X" };
    const code = await pgCode(
      db().insert(s.modifiers).values({ ...base, kind: "remove", priceDelta: 100 }),
    );
    expect(code).toBe(CHECK_VIOLATION);
    await expect(
      db().insert(s.modifiers).values({ ...base, kind: "remove", priceDelta: 0 }),
    ).resolves.toBeDefined();
    await expect(
      db().insert(s.modifiers).values({ ...base, name: "Extra", kind: "add", priceDelta: 100 }),
    ).resolves.toBeDefined();
  });
});

describe("foreign keys", () => {
  it("rejects order_items for a nonexistent order", async () => {
    const code = await pgCode(
      db().insert(s.orderItems).values({
        orderId: 999999,
        nameSnapshot: "X",
        unitPriceSnapshot: 100,
      }),
    );
    expect(code).toBe(FK_VIOLATION);
  });

  it("cascades order deletion to items, item modifiers and events", async () => {
    const [order] = await db().insert(s.orders).values(orderValues()).returning();
    const [item] = await db()
      .insert(s.orderItems)
      .values({ orderId: order.id, nameSnapshot: "Melt simple", unitPriceSnapshot: 5000 })
      .returning();
    await db().insert(s.orderItemModifiers).values({
      orderItemId: item.id,
      nameSnapshot: "Sin cheddar",
      kitchenLabel: "SIN CHEDDAR",
      kind: "remove",
      priceDelta: 0,
    });
    await db()
      .insert(s.orderEvents)
      .values({ orderId: order.id, toStatus: "pendiente_aprobacion" });

    await db().delete(s.orders).where(eq(s.orders.id, order.id));

    for (const table of [s.orderItems, s.orderItemModifiers, s.orderEvents]) {
      const [row] = await db().select({ n: sql<number>`count(*)::int` }).from(table);
      expect(row.n).toBe(0);
    }
  });

  it("sets order_items.product_id to NULL when the product is deleted, keeping the snapshot", async () => {
    const [cat] = await db().insert(s.categories).values({ name: "C", slug: "c" }).returning();
    const [product] = await db()
      .insert(s.products)
      .values({ categoryId: cat.id, name: "Melt simple", price: 5000 })
      .returning();
    const [order] = await db().insert(s.orders).values(orderValues()).returning();
    await db().insert(s.orderItems).values({
      orderId: order.id,
      productId: product.id,
      nameSnapshot: "Melt simple",
      unitPriceSnapshot: 5000,
    });

    await db().delete(s.products).where(eq(s.products.id, product.id));

    const [item] = await db().select().from(s.orderItems);
    expect(item.productId).toBeNull();
    expect(item.nameSnapshot).toBe("Melt simple");
    expect(item.unitPriceSnapshot).toBe(5000);
  });

  it("restricts deleting a category that still has products", async () => {
    const [cat] = await db().insert(s.categories).values({ name: "C", slug: "c" }).returning();
    await db().insert(s.products).values({ categoryId: cat.id, name: "P", price: 1 });
    const code = await pgCode(db().delete(s.categories).where(eq(s.categories.id, cat.id)));
    expect(code).toBe(FK_VIOLATION);
  });
});

describe("seed", () => {
  async function counts() {
    const tables = [
      s.categories,
      s.products,
      s.modifierGroups,
      s.modifiers,
      s.productModifierGroups,
      s.stations,
      s.cadets,
      s.settings,
      s.users,
    ];
    const out: number[] = [];
    for (const t of tables) {
      const [row] = await db().select({ n: sql<number>`count(*)::int` }).from(t);
      out.push(row.n);
    }
    return out;
  }

  it("is idempotent and creates the expected data without users", async () => {
    await seed(db());
    const first = await counts();
    await seed(db());
    expect(await counts()).toEqual(first);

    const [categories, products, , modifiers, , stations, cadets, , users] = first;
    expect(categories).toBe(9);
    expect(products).toBeGreaterThanOrEqual(10);
    expect(modifiers).toBeGreaterThan(0);
    expect(stations).toBe(2);
    expect(cadets).toBe(3);
    expect(users).toBe(0);
    const accepting = await db()
      .select()
      .from(s.settings)
      .where(eq(s.settings.key, "accepting_orders"));
    expect(accepting[0].value).toBe(true);
  });
});

describe("print_job_type enum (migration 0005)", () => {
  it("keeps the history values and adds delivery + customer, in that order", async () => {
    const r = await db().execute(sql`SELECT unnest(enum_range(NULL::print_job_type))::text AS v`);
    expect((r.rows as { v: string }[]).map((x) => x.v)).toEqual(["kitchen", "ticket", "delivery", "customer", "additional"]);
  });

  it("rows of every kind are legal (old kitchen/ticket history, new delivery/customer)", async () => {
    const [st] = await db().insert(s.stations).values({ name: "Enum test", kind: "mostrador" }).returning();
    const [o] = await db().insert(s.orders).values(orderValues()).returning();
    for (const type of ["kitchen", "ticket", "delivery", "customer"] as const) {
      await db().insert(s.printJobs).values({ orderId: o.id, stationId: st.id, type, payload: { blocks: [] } });
    }
    const got = await db().select().from(s.printJobs).where(eq(s.printJobs.orderId, o.id)).orderBy(s.printJobs.id);
    expect(got.map((j) => j.type)).toEqual(["kitchen", "ticket", "delivery", "customer"]);
  });
});

describe("order_addons", () => {
  const addonValues = (orderId: number, over: Partial<typeof s.orderAddons.$inferInsert> = {}): typeof s.orderAddons.$inferInsert => ({
    orderId,
    seq: 1,
    status: "pendiente_pago",
    units: [],
    subtotal: 1000,
    ...over,
  });

  it("order_addons rechaza seq duplicado por pedido", async () => {
    const [a] = await db().insert(s.orders).values(orderValues()).returning({ id: s.orders.id });
    const [b] = await db().insert(s.orders).values(orderValues()).returning({ id: s.orders.id });
    await db().insert(s.orderAddons).values(addonValues(a.id));
    expect(await pgCode(db().insert(s.orderAddons).values(addonValues(a.id)))).toBe(UNIQUE_VIOLATION);
    expect(await pgCode(db().insert(s.orderAddons).values(addonValues(b.id)))).toBeUndefined();
    expect(await pgCode(db().insert(s.orderAddons).values(addonValues(a.id, { seq: 2 })))).toBeUndefined();
  });

  it("order_addons.idempotency_key es único", async () => {
    const [a] = await db().insert(s.orders).values(orderValues()).returning({ id: s.orders.id });
    await db().insert(s.orderAddons).values(addonValues(a.id, { idempotencyKey: "k1" }));
    expect(await pgCode(db().insert(s.orderAddons).values(addonValues(a.id, { seq: 2, idempotencyKey: "k1" })))).toBe(UNIQUE_VIOLATION);
    expect(await pgCode(db().insert(s.orderAddons).values(addonValues(a.id, { seq: 2 })))).toBeUndefined();
    expect(await pgCode(db().insert(s.orderAddons).values(addonValues(a.id, { seq: 3 })))).toBeUndefined();
  });

  it("order_addons rechaza subtotal negativo", async () => {
    const [a] = await db().insert(s.orders).values(orderValues()).returning({ id: s.orders.id });
    expect(await pgCode(db().insert(s.orderAddons).values(addonValues(a.id, { subtotal: -1 })))).toBe(CHECK_VIOLATION);
  });
});
