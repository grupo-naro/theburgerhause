import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("@/test-support/next-mocks");
  return { headers: m.nextHeadersMock.headers, cookies: m.nextHeadersMock.cookies };
});
vi.mock("@/lib/menu/cache", () => ({ invalidateMenu: vi.fn(), MENU_CACHE_TAG: "menu" }));
vi.mock("@/lib/orders/create-order", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/orders/create-order")>();
  return { ...m, createOrder: vi.fn(m.createOrder) };
});

import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { invalidateMenu } from "@/lib/menu/cache";
import { createOrder } from "@/lib/orders/create-order";
import { setInitialStock } from "@/lib/stock/movements";
import { resetOrderRateLimit } from "@/lib/orders/order-rate-limit";
import { jar, requestHeaders, resetNextMocks } from "@/test-support/next-mocks";
import { createOrderAction } from "./actions";

const db = () => testDb();
let productId: number;

const payload = (over: Record<string, unknown> = {}) => ({
  idempotencyKey: crypto.randomUUID(),
  units: [{ productId, modifierIds: [], note: "" }],
  customer: { name: "Juana Pérez", whatsapp: "11 5555-1234" },
  fulfillment: "takeaway",
  paymentMethod: "cash",
  bh_ref: "",
  ...over,
});
const withWa = (i: number) => payload({ customer: { name: "Juana", whatsapp: `1155550${100 + i}` } });
const orderCount = async () => (await db().select().from(s.orders)).length;
const asIp = (xff: string) => void (requestHeaders.value = new Headers({ "x-forwarded-for": xff }));
const LIMIT_MSG = "Demasiados pedidos seguidos. Esperá unos minutos o llamanos.";

beforeEach(async () => {
  await resetDb();
  resetNextMocks();
  resetOrderRateLimit();
  vi.mocked(createOrder).mockClear();
  vi.mocked(invalidateMenu).mockClear();
  const [cat] = await db().insert(s.categories).values({ name: "B", slug: "b" }).returning();
  const [p] = await db().insert(s.products).values({ categoryId: cat.id, name: "Ranchita", price: 850000 }).returning();
  productId = p.id;
});
afterAll(closeDb);

describe("createOrderAction", () => {
  it("creates an order without any auth/session and returns a serializable success", async () => {
    expect(jar.size).toBe(0);
    const r = await createOrderAction(payload());
    expect(r).toMatchObject({ ok: true, number: 1, total: 850000, duplicate: false });
    expect(r.ok && r.publicToken).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(await orderCount()).toBe(1);
  });

  it("maps expected failures to serializable results (never throws)", async () => {
    expect(await createOrderAction(payload({ customer: { name: "x", whatsapp: "1" } }))).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { "customer.name": expect.any(String), "customer.whatsapp": expect.any(String) },
    });
    expect(await createOrderAction(payload({ bh_ref: "spam" }))).toMatchObject({ ok: false, code: "HONEYPOT" });
    expect(await createOrderAction(payload({ units: [{ productId: 9999, modifierIds: [], note: "" }] }))).toMatchObject({
      ok: false,
      code: "UNITS_INVALID",
      unitIssues: [{ unitIndex: 0, code: "PRODUCT_UNAVAILABLE" }],
    });
    await db().insert(s.settings).values({ key: "accepting_orders", value: false });
    expect(await createOrderAction(payload())).toMatchObject({ ok: false, code: "STORE_CLOSED" });
    expect(await createOrderAction(undefined)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await orderCount()).toBe(0);
  });

  describe("rate limit", () => {
    const create = async (n: number, start = 0) => {
      for (let i = start; i < start + n; i++) expect((await createOrderAction(withWa(i))).ok).toBe(true);
    };

    it("20 creations per IP in the window; the 21st is refused and creates no row", async () => {
      await create(20);
      const r = await createOrderAction(withWa(99));
      expect(r).toEqual({ ok: false, code: "RATE_LIMITED", message: LIMIT_MSG });
      expect(await orderCount()).toBe(20);
    });

    it("3 creations per whatsapp (digits), the 4th is refused even from a new IP, BEFORE createOrder runs", async () => {
      const spellings = ["11 5555-1234", "(11) 5555 1234", "+11-5555-1234"];
      for (let i = 0; i < 3; i++) {
        asIp(`10.0.1.${i}`);
        const r = await createOrderAction(payload({ customer: { name: "Juana", whatsapp: spellings[i] } }));
        expect(r.ok).toBe(true);
      }
      asIp("10.0.1.99");
      vi.mocked(createOrder).mockClear();
      expect(await createOrderAction(payload())).toEqual({ ok: false, code: "RATE_LIMITED", message: LIMIT_MSG });
      expect(createOrder).not.toHaveBeenCalled();
      expect(await orderCount()).toBe(3);
    });

    it("a spoofed first X-Forwarded-For hop does not bypass the IP limit (LAST hop counts)", async () => {
      for (let i = 0; i < 20; i++) {
        asIp(`6.6.6.${i}, 203.0.113.7`);
        expect((await createOrderAction(withWa(i))).ok).toBe(true);
      }
      asIp("7.7.7.7, 203.0.113.7");
      expect(await createOrderAction(withWa(99))).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    });

    it("another real client (different last hop) is unaffected", async () => {
      asIp("203.0.113.7");
      await create(20);
      asIp("203.0.113.8");
      expect((await createOrderAction(withWa(99))).ok).toBe(true);
    });

    it("failed attempts (stale cart, closed store, invalid) do NOT consume creation quota", async () => {
      for (let i = 0; i < 5; i++) {
        const r = await createOrderAction(payload({ units: [{ productId: 9999, modifierIds: [], note: "" }] }));
        expect(r).toMatchObject({ ok: false, code: "UNITS_INVALID" });
      }
      await db().insert(s.settings).values({ key: "accepting_orders", value: false });
      for (let i = 0; i < 5; i++) expect(await createOrderAction(payload())).toMatchObject({ code: "STORE_CLOSED" });
      await db().update(s.settings).set({ value: true });
      for (let i = 0; i < 3; i++) expect((await createOrderAction(payload())).ok).toBe(true);
      expect(await createOrderAction(payload())).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    });

    it("idempotent replays do NOT consume quota and still answer when the quota is exhausted", async () => {
      const same = payload();
      const first = await createOrderAction(same);
      if (!first.ok) throw new Error("expected ok");
      for (let i = 0; i < 8; i++) {
        expect(await createOrderAction(same)).toMatchObject({ ok: true, duplicate: true, publicToken: first.publicToken });
      }
      expect((await createOrderAction(payload())).ok).toBe(true);
      expect((await createOrderAction(payload())).ok).toBe(true);
      expect(await createOrderAction(payload())).toMatchObject({ ok: false, code: "RATE_LIMITED" });
      // whatsapp quota is spent, yet the original order is still answered
      expect(await createOrderAction(same)).toMatchObject({ ok: true, duplicate: true, publicToken: first.publicToken });
      expect(await orderCount()).toBe(3);
    });

    it("two PARALLEL same-key submissions consume exactly ONE creation slot", async () => {
      const same = payload();
      const [a, b] = await Promise.all([createOrderAction(same), createOrderAction(same)]);
      expect(a.ok && b.ok).toBe(true);
      expect(a.ok && b.ok && a.publicToken === b.publicToken).toBe(true);
      expect(await orderCount()).toBe(1);
      expect((await createOrderAction(payload())).ok).toBe(true);
      expect((await createOrderAction(payload())).ok).toBe(true);
      expect(await createOrderAction(payload())).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    });

    it("a closed store still answers a replay of an existing order (action level)", async () => {
      const same = payload();
      const first = await createOrderAction(same);
      await db().insert(s.settings).values({ key: "accepting_orders", value: false });
      const again = await createOrderAction(same);
      expect(again).toMatchObject({ ok: true, duplicate: true });
      expect(again.ok && first.ok && again.publicToken).toBe(first.ok && first.publicToken);
      expect(await createOrderAction(payload())).toMatchObject({ ok: false, code: "STORE_CLOSED" });
    });

    it("the attempt limiter trips at the 61st request per IP (any kind of request)", async () => {
      for (let i = 0; i < 60; i++) {
        const r = await createOrderAction(i % 2 ? payload({ bh_ref: "x" }) : payload({ customer: { name: "x", whatsapp: "1" } }));
        expect(r).toMatchObject({ ok: false });
        expect((r as { code: string }).code).not.toBe("RATE_LIMITED");
      }
      vi.mocked(createOrder).mockClear();
      expect(await createOrderAction(payload())).toEqual({ ok: false, code: "RATE_LIMITED", message: LIMIT_MSG });
      expect(createOrder).not.toHaveBeenCalled();
      asIp("203.0.113.50");
      expect((await createOrderAction(payload())).ok).toBe(true);
    });

    it("invalid / honeypot submissions do not touch the creation quota", async () => {
      for (let i = 0; i < 10; i++) await createOrderAction(payload({ bh_ref: "x" }));
      for (let i = 0; i < 10; i++) await createOrderAction(payload({ customer: { name: "x", whatsapp: "1" } }));
      for (let i = 0; i < 3; i++) expect((await createOrderAction(payload())).ok).toBe(true);
    });

    it("without an x-forwarded-for header everyone shares the single 'unknown' bucket (fail-closed)", async () => {
      requestHeaders.value = new Headers();
      for (let i = 0; i < 60; i++) await createOrderAction(payload({ bh_ref: "x" }));
      expect(await createOrderAction(payload())).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    });

    it("resetOrderRateLimit clears the counters", async () => {
      for (let i = 0; i < 3; i++) await createOrderAction(payload());
      expect(await createOrderAction(payload())).toMatchObject({ code: "RATE_LIMITED" });
      resetOrderRateLimit();
      expect((await createOrderAction(payload())).ok).toBe(true);
    });
  });

  describe("unexpected errors", () => {
    it("returns a fixed generic message; nothing from the error leaks; logs only a fixed string + pg code", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const err = Object.assign(new Error('select * from "orders" where secret = 42 -- stack here'), { code: "57P01" });
      vi.mocked(createOrder).mockRejectedValueOnce(err);
      const r = await createOrderAction(payload());
      expect(r).toEqual({ ok: false, code: "INTERNAL", message: "No pudimos crear tu pedido. Probá de nuevo en unos minutos." });
      expect(JSON.stringify(r)).not.toMatch(/select|secret|stack|orders/i);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]).toEqual(["[createOrderAction] unexpected error", "57P01"]);
      spy.mockRestore();
    });

    it("an error without a pg code logs 'unknown'", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(createOrder).mockRejectedValueOnce(new Error("boom"));
      await createOrderAction(payload());
      expect(spy.mock.calls[0]).toEqual(["[createOrderAction] unexpected error", "unknown"]);
      spy.mockRestore();
    });
  });

  describe("drink stock", () => {
    async function linkDrink(units: number) {
      const [u] = await db().insert(s.users).values({ name: "E", username: "e", passwordHash: "x", role: "encargado" }).returning();
      const [item] = await db().insert(s.stockItems).values({ name: "Coca 500", kind: "bebida", unit: "u", minQty: 0 }).returning();
      await db().update(s.products).set({ stockItemId: item.id }).where(eq(s.products.id, productId));
      const r = await setInitialStock(db(), { itemId: item.id, userId: u.id, milli: units * 1000 });
      if (!r.ok) throw new Error(r.message);
      vi.mocked(invalidateMenu).mockClear();
    }

    it("OUT_OF_STOCK comes back with the message and the products; no order", async () => {
      await linkDrink(0);
      const r = await createOrderAction(payload());
      expect(r).toEqual({
        ok: false,
        code: "OUT_OF_STOCK",
        message: "Se agotó Ranchita. Sacala del pedido para continuar.",
        productIds: [productId],
        names: ["Ranchita"],
      });
      expect(await orderCount()).toBe(0);
      expect(invalidateMenu).not.toHaveBeenCalled();
    });

    it("selling the last unit refreshes the cached menu (the drink is now stock-paused)", async () => {
      await linkDrink(2);
      expect(await createOrderAction(payload())).toMatchObject({ ok: true });
      expect(invalidateMenu).not.toHaveBeenCalled();
      expect(await createOrderAction(payload())).toMatchObject({ ok: true });
      expect(invalidateMenu).toHaveBeenCalledTimes(1);
    });
  });
});
