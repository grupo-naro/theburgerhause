import { beforeEach, describe, expect, it, vi } from "vitest";

const getTrackingStatus = vi.fn();
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/orders/tracking", async (orig) => ({
  ...(await orig<typeof import("@/lib/orders/tracking")>()),
  getTrackingStatus: (...args: unknown[]) => getTrackingStatus(...args),
}));

import { resetTrackingRateLimit } from "@/lib/orders/tracking-rate-limit";
import { GET } from "./route";

const TOKEN = "0123456789abcdef0123456789abcdef";
const OTHER = "f".repeat(32);
const STATUS = { status: "en_preparacion", paymentStatus: "pending", updatedAt: "2026-10-15T12:00:00.000Z" };

const call = (token: string, ip = "1.2.3.4") =>
  GET(new Request(`http://localhost:3000/api/pedido/${token}/status`, { headers: { "x-forwarded-for": ip } }), {
    params: Promise.resolve({ token }),
  });

beforeEach(() => {
  resetTrackingRateLimit();
  getTrackingStatus.mockReset();
  getTrackingStatus.mockImplementation(async (_db: unknown, token: string) => (token === TOKEN ? STATUS : null));
});

describe("GET /api/pedido/[token]/status", () => {
  it("returns ONLY the three fields, uncached, without cookies", async () => {
    const res = await call(TOKEN);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(STATUS);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("drops any extra field the read model might add", async () => {
    getTrackingStatus.mockResolvedValue({ ...STATUS, whatsapp: "5491155551234", id: 7 });
    expect(await (await call(TOKEN)).json()).toEqual(STATUS);
  });

  it("malformed tokens are 404 and never reach the read model's lookup", async () => {
    for (const t of ["abc", TOKEN.toUpperCase(), `${TOKEN}0`, "x".repeat(200)]) {
      const res = await call(t);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(getTrackingStatus).not.toHaveBeenCalled();
  });

  it("unknown and malformed tokens answer with the identical body", async () => {
    const unknown = await call(OTHER);
    const malformed = await call("nope");
    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(await unknown.text()).toBe(await malformed.text());
  });

  it("limits requests: the 61st in a minute is 429, generic, with Retry-After", async () => {
    for (let i = 0; i < 60; i++) expect((await call(TOKEN)).status).toBe(200);
    const res = await call(TOKEN);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "too many requests" });
    // another IP is unaffected
    expect((await call(TOKEN, "5.6.7.8")).status).toBe(200);
  });

  it("limits unknown-token lookups: the 31st miss is 429, hits are not counted", async () => {
    for (let i = 0; i < 30; i++) expect((await call(OTHER)).status).toBe(404);
    expect((await call(OTHER)).status).toBe(429);
    expect((await call(TOKEN)).status).toBe(429); // the IP is locked out of lookups for now
    expect((await call(OTHER, "9.9.9.9")).status).toBe(404); // other IPs unaffected
  });

  it("valid hits never consume the miss budget", async () => {
    for (let i = 0; i < 40; i++) expect((await call(TOKEN)).status).toBe(200);
    expect((await call(OTHER)).status).toBe(404);
  });
});
