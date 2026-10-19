import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/auth/roles";

const requireRole = vi.fn();
vi.mock("@/lib/auth/require-role", () => ({ requireRole: (...a: unknown[]) => requireRole(...a) }));

import { listenerCount, publish, resetBus } from "./bus";
import { ORDERS_CHANNEL, PRINT_CHANNEL } from "./channels";
import { connectionStats, createEventsHandler, resetConnectionStats } from "./sse";

const session = (id = 1, role = "cajera") => ({ user: { id, role, name: "x", username: "x" }, stationId: null, stationKind: null, sessionId: "s" });
const ev = { orderId: 12, status: "pendiente_aprobacion", event: "created" } as const;

type Conn = { cancel: () => Promise<void>; res: Response; ac: AbortController; read: (until: string, ms?: number) => Promise<string>; text: () => string };

const wait = (ms: number) => new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

async function open(handler: (r: Request) => Promise<Response>): Promise<Conn> {
  const ac = new AbortController();
  const res = await handler(new Request("http://localhost/api/events", { signal: ac.signal }));
  let buf = "";
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const dec = new TextDecoder();
  return {
    res,
    ac,
    text: () => buf,
    cancel: async () => {
      reader ??= res.body!.getReader();
      await reader.cancel();
    },
    read: async (until: string, ms = 1000) => {
      reader ??= res.body!.getReader();
      const deadline = Date.now() + ms;
      while (!buf.includes(until)) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`timeout waiting for ${JSON.stringify(until)}; got ${JSON.stringify(buf)}`);
        const r = await Promise.race([reader.read(), wait(left)]);
        if (r === null) continue;
        if (r.done) throw new Error(`stream ended; got ${JSON.stringify(buf)}`);
        buf += dec.decode(r.value);
      }
      return buf;
    },
  };
}

/** Resolves when the server closes the stream. */
async function ended(c: Conn, ms = 1000): Promise<void> {
  const reader = c.res.body!.getReader();
  const deadline = Date.now() + ms;
  for (;;) {
    const r = await Promise.race([reader.read(), wait(Math.max(1, deadline - Date.now()))]);
    if (r === null) throw new Error("stream did not close");
    if (r.done) return;
  }
}

const fast = { pingMs: 10_000, revalidateMs: 10_000 };
const revalidate = vi.fn();

beforeEach(() => {
  requireRole.mockReset();
  requireRole.mockResolvedValue(session());
  revalidate.mockReset();
  revalidate.mockResolvedValue(true);
  resetBus();
  resetConnectionStats();
});
afterEach(() => {
  resetBus();
});

const handlerWith = (extra: Record<string, unknown> = {}) => createEventsHandler({ ...fast, revalidate, ...extra });

describe("events handler: auth and headers", () => {
  it("401 without a session, 403 for a wrong role", async () => {
    const h = handlerWith();
    requireRole.mockRejectedValueOnce(new AuthError("UNAUTHENTICATED"));
    const a = await open(h);
    expect(a.res.status).toBe(401);
    expect(await a.res.json()).toEqual({ error: expect.any(String) });
    requireRole.mockRejectedValueOnce(new AuthError("FORBIDDEN"));
    const b = await open(h);
    expect(b.res.status).toBe(403);
    expect(connectionStats().total).toBe(0);
  });

  it("asks for the staff roles (kitchen included)", async () => {
    const c = await open(handlerWith());
    expect(requireRole).toHaveBeenCalledWith("admin", "cajera", "encargada_delivery", "cocina", "encargado");
    c.ac.abort();
  });

  it("sends SSE headers, then retry and hello frames first", async () => {
    const c = await open(handlerWith());
    expect(c.res.status).toBe(200);
    expect(c.res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(c.res.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(c.res.headers.get("connection")).toBe("keep-alive");
    expect(c.res.headers.get("x-accel-buffering")).toBe("no");
    await c.read("event: hello");
    await c.read("}\n\n");
    expect(c.text().startsWith("retry: 3000\n\nevent: hello\ndata: ")).toBe(true);
    const hello = /event: hello\ndata: (.*)\n\n/.exec(c.text());
    expect(hello).not.toBeNull();
    const data = JSON.parse(hello![1]);
    expect(typeof data.connectionId).toBe("string");
    expect(Number.isNaN(Date.parse(data.serverTime))).toBe(false);
    c.ac.abort();
  });
});

describe("events handler: stream", () => {
  it("forwards orders events with correct framing", async () => {
    const c = await open(handlerWith());
    await c.read("event: hello");
    publish(ORDERS_CHANNEL, ev);
    await c.read(`event: orders\ndata: ${JSON.stringify(ev)}\n\n`);
    c.ac.abort();
  });

  it("does NOT forward print events; forwards resync", async () => {
    const c = await open(handlerWith());
    await c.read("event: hello");
    publish(PRINT_CHANNEL, { jobId: 1, stationId: 1 });
    publish("resync");
    await c.read("event: resync\ndata: {}\n\n");
    expect(c.text()).not.toContain("jobId");
    c.ac.abort();
  });

  it("sends a ping comment after the interval", async () => {
    const c = await open(handlerWith({ pingMs: 15 }));
    await c.read(": ping\n\n");
    c.ac.abort();
  });

  it("closes the stream when the session becomes invalid", async () => {
    const c = await open(handlerWith({ revalidateMs: 15 }));
    revalidate.mockResolvedValue(false);
    await ended(c);
    expect(listenerCount()).toBe(0);
    expect(connectionStats().total).toBe(0);
  });

  it("keeps the stream if revalidation merely errors, without logging details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    revalidate.mockRejectedValue(new Error("db down: secret"));
    const c = await open(handlerWith({ revalidateMs: 10 }));
    await vi.waitFor(() => expect(revalidate.mock.calls.length).toBeGreaterThan(1));
    publish(ORDERS_CHANNEL, ev);
    await c.read("event: orders");
    expect(spy).toHaveBeenCalledWith("[events] session revalidation failed");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("secret");
    c.ac.abort();
    spy.mockRestore();
  });

  it("abort releases bus subscriptions, timers and counters", async () => {
    const before = listenerCount();
    const c = await open(handlerWith({ pingMs: 5, revalidateMs: 5 }));
    await c.read("event: hello");
    expect(listenerCount()).toBeGreaterThan(before);
    expect(connectionStats().total).toBe(1);
    c.ac.abort();
    expect(listenerCount()).toBe(before);
    expect(connectionStats()).toEqual({ total: 0, byUser: {} });
    const calls = revalidate.mock.calls.length;
    await wait(30); // negative check: no revalidation timer survives the abort
    expect(revalidate.mock.calls.length).toBe(calls);
  });

  it("an already-aborted request opens nothing", async () => {
    const ac = new AbortController();
    ac.abort();
    const res = await handlerWith()(new Request("http://localhost/api/events", { signal: ac.signal }));
    expect(listenerCount()).toBe(0);
    expect(connectionStats().total).toBe(0);
    await res.body?.cancel();
  });

  it("client cancel (reader.cancel) also cleans up", async () => {
    const c = await open(handlerWith());
    await c.read("event: hello");
    await c.cancel();
    expect(listenerCount()).toBe(0);
    expect(connectionStats().total).toBe(0);
  });

  it("slow clients: drops events instead of buffering, then sends one resync", async () => {
    const c = await open(handlerWith({ queueSize: 2 }));
    // Nobody reads: retry+hello fill the queue and everything else is dropped.
    for (let i = 0; i < 50; i++) publish(ORDERS_CHANNEL, { ...ev, orderId: i + 1 });
    const reader = c.res.body!.getReader();
    const dec = new TextDecoder();
    let all = "";
    for (let i = 0; i < 2; i++) all += dec.decode((await reader.read()).value);
    expect(all).not.toContain("event: orders");
    // Room again: the next event is preceded by exactly one resync.
    publish(ORDERS_CHANNEL, { ...ev, orderId: 99 });
    let more = "";
    while (!more.includes('"orderId":99')) more += dec.decode((await reader.read()).value);
    expect(more.match(/event: resync/g)).toHaveLength(1);
    expect(more.indexOf("event: resync")).toBeLessThan(more.indexOf('"orderId":99'));
    c.ac.abort();
  });
});

describe("events handler: caps", () => {
  it("11th stream of one user gets 429, and the slot frees after an abort", async () => {
    const h = handlerWith();
    const conns: Conn[] = [];
    for (let i = 0; i < 10; i++) conns.push(await open(h));
    const over = await open(h);
    expect(over.res.status).toBe(429);
    expect(await over.res.json()).toEqual({ error: expect.any(String) });
    expect(connectionStats().byUser).toEqual({ 1: 10 });
    conns[0].ac.abort();
    const again = await open(h);
    expect(again.res.status).toBe(200);
    conns.slice(1).forEach((c) => c.ac.abort());
    again.ac.abort();
    expect(connectionStats()).toEqual({ total: 0, byUser: {} });
  });

  it("another user is not affected by someone else's cap", async () => {
    const h = handlerWith({ perUserCap: 1 });
    const a = await open(h);
    requireRole.mockResolvedValue(session(2));
    const b = await open(h);
    expect(b.res.status).toBe(200);
    a.ac.abort();
    b.ac.abort();
  });

  it("global cap gives 429", async () => {
    const h = handlerWith({ globalCap: 3 });
    const conns: Conn[] = [];
    for (let i = 0; i < 3; i++) {
      requireRole.mockResolvedValue(session(i + 1));
      conns.push(await open(h));
    }
    requireRole.mockResolvedValue(session(9));
    expect((await open(h)).res.status).toBe(429);
    conns.forEach((c) => c.ac.abort());
    expect(connectionStats().total).toBe(0);
  });
});
