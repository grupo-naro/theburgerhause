import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/auth/roles";

const requireRole = vi.fn();
vi.mock("@/lib/auth/require-role", () => ({ requireRole: (...a: unknown[]) => requireRole(...a) }));

import { listenerCount, publish } from "@/lib/events/bus";
import { GET } from "./route";

afterEach(() => requireRole.mockReset());

describe("GET /api/events", () => {
  it("401 without a session", async () => {
    requireRole.mockRejectedValue(new AuthError("UNAUTHENTICATED"));
    const res = await GET(new Request("http://localhost/api/events"));
    expect(res.status).toBe(401);
  });

  it("403 for a role that is not allowed", async () => {
    requireRole.mockRejectedValue(new AuthError("FORBIDDEN"));
    const res = await GET(new Request("http://localhost/api/events"));
    expect(res.status).toBe(403);
  });

  it("streams for staff and unsubscribes on abort", async () => {
    requireRole.mockResolvedValue({ user: { id: 7, role: "admin" } });
    const ac = new AbortController();
    const before = listenerCount();
    const res = await GET(new Request("http://localhost/api/events", { signal: ac.signal }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    while (!text.includes("event: hello")) text += dec.decode((await reader.read()).value);
    publish("orders_changed", { orderId: 1, status: "entregado", event: "status" });
    while (!text.includes("event: orders")) text += dec.decode((await reader.read()).value);
    ac.abort();
    expect(listenerCount()).toBe(before);
  });
});
