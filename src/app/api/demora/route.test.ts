import { beforeEach, describe, expect, it, vi } from "vitest";

const getPublicDelay = vi.fn();
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/delay/public", () => ({ getPublicDelay: (...args: unknown[]) => getPublicDelay(...args) }));

import { resetDemoraRateLimit } from "@/lib/delay/rate-limit";
import { GET } from "./route";

const DELAY = { takeaway: { low: 20, high: 30 }, delivery: { low: 35, high: 45 }, delayed: false };
const call = (ip = "1.2.3.4") => GET(new Request("http://localhost:3000/api/demora", { headers: { "x-forwarded-for": ip } }));

beforeEach(() => {
  resetDemoraRateLimit();
  getPublicDelay.mockReset();
  getPublicDelay.mockResolvedValue(DELAY);
});

describe("GET /api/demora", () => {
  it("returns exactly the allow-listed keys with no-store headers", async () => {
    getPublicDelay.mockResolvedValue({ ...DELAY, reason: "secreto", id: 3 });
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["delayed", "delivery", "takeaway"]);
    expect(body).toEqual(DELAY);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("answers 503 with an empty body when the database fails", async () => {
    getPublicDelay.mockRejectedValue(new Error("db down"));
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("limits requests: the 121st in a minute is 429, other IPs unaffected", async () => {
    for (let i = 0; i < 120; i++) expect((await call()).status).toBe(200);
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await call("5.6.7.8")).status).toBe(200);
  });
});
