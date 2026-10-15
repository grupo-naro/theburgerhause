import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { GET } from "./route";

afterAll(closeDb);

describe("GET /api/agent/stream (route wiring)", () => {
  it("is the token-authenticated handler: no credentials -> uniform 401", async () => {
    const res = await GET(new Request("http://localhost/api/agent/stream", { headers: { "x-forwarded-for": "7.7.7.7" } }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});
