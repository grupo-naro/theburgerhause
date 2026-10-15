import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("@/test-support/next-mocks");
  return { headers: m.nextHeadersMock.headers, cookies: m.nextHeadersMock.cookies };
});
vi.mock("@/lib/orders/create-order", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/lib/orders/create-order")>();
  return { ...m, createOrder: vi.fn(m.createOrder) };
});

import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { createOrder } from "@/lib/orders/create-order";
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
  website: "",
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
    expect(await createOrderAction(payload({ website: "spam" }))).toMatchObject({ ok: false, code: "HONEYPOT" });
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
    it("5 orders per IP in the window; the 6th is refused and creates no row", async () => {
      for (let i = 0; i < 5; i++) expect((await createOrderAction(withWa(i))).ok).toBe(true);
      const r = await createOrderAction(withWa(9));
      expect(r).toEqual({ ok: false, code: "RATE_LIMITED", message: LIMIT_MSG });
      expect(await orderCount()).toBe(5);
    });

    it("the limiter runs BEFORE createOrder is called", async () => {
      for (let i = 0; i < 5; i++) await createOrderAction(withWa(i));
      vi.mocked(createOrder).mockClear();
      await createOrderAction(withWa(9));
      expect(createOrder).not.toHaveBeenCalled();
    });

    it("3 orders per whatsapp (digits), the 4th is refused even from a new IP", async () => {
      const spellings = ["11 5555-1234", "(11) 5555 1234", "+11-5555-1234"];
      for (let i = 0; i < 3; i++) {
        asIp(`10.0.1.${i}`);
        const r = await createOrderAction(payload({ customer: { name: "Juana", whatsapp: spellings[i] } }));
        expect(r.ok).toBe(true);
      }
      asIp("10.0.1.99");
      expect(await createOrderAction(payload())).toEqual({ ok: false, code: "RATE_LIMITED", message: LIMIT_MSG });
      expect(await orderCount()).toBe(3);
    });

    it("a spoofed first X-Forwarded-For hop does not bypass the IP limit (LAST hop counts)", async () => {
      for (let i = 0; i < 5; i++) {
        asIp(`6.6.6.${i}, 203.0.113.7`);
        expect((await createOrderAction(withWa(i))).ok).toBe(true);
      }
      asIp("7.7.7.7, 203.0.113.7");
      expect(await createOrderAction(withWa(9))).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    });

    it("another real client (different last hop) is unaffected", async () => {
      asIp("203.0.113.7");
      for (let i = 0; i < 5; i++) await createOrderAction(withWa(i));
      asIp("203.0.113.8");
      expect((await createOrderAction(withWa(9))).ok).toBe(true);
    });

    it("idempotent duplicates (double click / retry) do NOT consume the quota", async () => {
      const same = payload();
      const first = await createOrderAction(same);
      if (!first.ok) throw new Error("expected ok");
      for (let i = 0; i < 8; i++) {
        const again = await createOrderAction(same);
        expect(again).toMatchObject({ ok: true, duplicate: true, publicToken: first.publicToken });
      }
      // 3 whatsapp slots, 1 used: two more orders fit, the third does not
      expect((await createOrderAction(payload())).ok).toBe(true);
      expect((await createOrderAction(payload())).ok).toBe(true);
      expect(await createOrderAction(payload())).toMatchObject({ ok: false, code: "RATE_LIMITED" });
      expect(await orderCount()).toBe(3);
    });

    it("duplicate replays are bounded too (30 per window per IP)", async () => {
      const same = payload();
      await createOrderAction(same);
      let limited = 0;
      for (let i = 0; i < 40; i++) if ((await createOrderAction(same)).ok === false) limited++;
      expect(limited).toBeGreaterThan(0);
    });

    it("invalid / honeypot submissions do not touch the quota", async () => {
      for (let i = 0; i < 10; i++) await createOrderAction(payload({ website: "x" }));
      for (let i = 0; i < 10; i++) await createOrderAction(payload({ customer: { name: "x", whatsapp: "1" } }));
      expect((await createOrderAction(payload())).ok).toBe(true);
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
});
