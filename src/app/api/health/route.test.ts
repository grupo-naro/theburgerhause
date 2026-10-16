import { describe, expect, it, vi } from "vitest";

// The default DB probe must fail closed (503, no leak) when the pool cannot reach Postgres.
vi.mock("@/db/client", () => ({
  getDb: () => ({
    execute: async () => {
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1 user=burgerhause"), { code: "ECONNREFUSED" });
    },
  }),
}));

import { GET } from "./route";

describe("GET /api/health route", () => {
  it("is a 503 without leakage when the database is unreachable", async () => {
    const res = await GET(new Request("http://localhost/api/health", { headers: { "x-forwarded-for": "192.0.2.77" } }));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "degraded", db: "down" });
    expect(text).not.toMatch(/ECONNREFUSED|burgerhause|127\.0\.0\.1/);
  });
});
