import { describe, expect, it, vi } from "vitest";
import { createHealthHandler } from "./health";

const req = (ip?: string) =>
  new Request("http://localhost/api/health", { headers: ip ? { "x-forwarded-for": ip } : {} });

describe("GET /api/health handler", () => {
  it("200 with ok body when the DB answers; realtime and commit are informational", async () => {
    const GET = createHealthHandler({
      checkDb: async () => {},
      realtime: () => "live",
      commit: "abc1234",
      version: "1.2.3",
      now: () => new Date("2026-01-02T03:04:05.000Z"),
    });
    const res = await GET(req("203.0.113.9"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      db: "ok",
      realtime: "live",
      time: "2026-01-02T03:04:05.000Z",
      version: "1.2.3",
      commit: "abc1234",
    });
  });

  it("omits commit when not provided", async () => {
    const GET = createHealthHandler({ checkDb: async () => {}, realtime: () => "down", commit: undefined });
    const body = await (await GET(req())).json();
    expect(body.commit).toBeUndefined();
    expect(body.status).toBe("ok"); // realtime down never fails the check
    expect(body.realtime).toBe("down");
  });

  it("is never cached and not sniffable", async () => {
    const GET = createHealthHandler({ checkDb: async () => {} });
    const res = await GET(req());
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("503 degraded without leaking the error text when the DB fails", async () => {
    const GET = createHealthHandler({
      checkDb: async () => {
        throw new Error("password authentication failed for user burgerhause postgres://u:s3cret@10.0.0.5/db");
      },
    });
    const res = await GET(req());
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "degraded", db: "down" });
    expect(text).not.toMatch(/s3cret|postgres|password|10\.0\.0\.5/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("503 when the DB does not answer within the timeout", async () => {
    vi.useFakeTimers();
    try {
      const GET = createHealthHandler({ checkDb: () => new Promise<void>(() => {}), timeoutMs: 2000 });
      const p = GET(req());
      await vi.advanceTimersByTimeAsync(2001);
      const res = await p;
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ status: "degraded", db: "down" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never throws even if realtime status or the clock throws", async () => {
    const GET = createHealthHandler({
      checkDb: async () => {},
      realtime: () => {
        throw new Error("boom");
      },
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).realtime).toBe("down");
  });

  it("rate limits per client IP (last hop) at 60/min and sets Retry-After", async () => {
    const check = vi.fn(async () => {});
    const GET = createHealthHandler({ checkDb: check });
    for (let i = 0; i < 60; i++) expect((await GET(req("198.51.100.1"))).status).toBe(200);
    const limited = await GET(req("198.51.100.1"));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect(check).toHaveBeenCalledTimes(60); // limited requests do not touch the DB
    // another IP is unaffected; a spoofed first hop does not help
    expect((await GET(req("198.51.100.2"))).status).toBe(200);
    expect((await GET(req("1.1.1.1, 198.51.100.1"))).status).toBe(429);
  });
});
