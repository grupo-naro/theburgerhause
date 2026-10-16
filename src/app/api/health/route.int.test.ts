import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { GET } from "./route";

afterAll(closeDb);

describe("GET /api/health (real database)", () => {
  it("200 ok when SELECT 1 succeeds", async () => {
    const res = await GET(new Request("http://localhost/api/health", { headers: { "x-forwarded-for": "192.0.2.10" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", db: "ok" });
    expect(["live", "down"]).toContain(body.realtime);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
