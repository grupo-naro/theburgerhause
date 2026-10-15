import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "./logger";
import { StreamClient } from "./client";
import type { AgentJob } from "./protocol";
import { CaptureLog, FakeClock, FakeServer, sampleJob, settle, waitUntil } from "./testing/support";
import { EventEmitter } from "node:events";

let server: FakeServer;
let clock: FakeClock;
let log: CaptureLog;
let client: StreamClient | null = null;
const jobs: AgentJob[] = [];
const jobsChanged = new EventEmitter();

beforeEach(async () => {
  server = await FakeServer.start();
  clock = new FakeClock();
  log = new CaptureLog();
  jobs.length = 0;
});
afterEach(async () => {
  await client?.stop();
  client = null;
  await server.stop();
});

function make(token = server.token, rng = () => 0) {
  client = new StreamClient({
    serverUrl: server.url,
    token,
    clock,
    rng,
    logger: createLogger({ level: "debug", sinks: [log.sink] }),
    onJob: (j) => {
      jobs.push(j);
      jobsChanged.emit("change");
    },
  });
  return client;
}
const reconnectDelay = () => clock.pending("reconnect")[0].ms;

describe("StreamClient: connecting", () => {
  it("sends the bearer token, logs hello, and hands jobs over in arrival order", async () => {
    make().start();
    await server.waitForStreams(1);
    expect(server.streamRequests[0].auth).toBe(`Bearer ${server.token}`);
    server.stream.hello();
    await log.waitFor("conectado");
    server.stream.job(sampleJob(1));
    server.stream.job(sampleJob(2));
    server.stream.job(sampleJob(3));
    await waitUntil(() => jobs.length === 3, [jobsChanged], "3 jobs");
    expect(jobs.map((j) => j.id)).toEqual([1, 2, 3]);
    expect(client!.connected).toBe(true);
  });

  it("ignores malformed frames and unknown events without dropping the connection", async () => {
    make().start();
    await server.waitForStreams(1);
    server.stream.sendRaw("event: mystery\ndata: {}\n\nevent: job\ndata: {oops\n\n: ping\n\n");
    server.stream.job(sampleJob(9));
    await waitUntil(() => jobs.length === 1, [jobsChanged], "job 9");
    expect(client!.connected).toBe(true);
  });
});

describe("StreamClient: reconnect backoff", () => {
  it("reconnects after the server closes the stream, with delays 1 s, 2 s, 4 s ...", async () => {
    make().start();
    const delays: number[] = [];
    for (let i = 1; i <= 4; i++) {
      await server.waitForStreams(i);
      server.stream.end();
      await clock.waitForTimer("reconnect");
      delays.push(reconnectDelay());
      await clock.fire("reconnect");
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
  });

  it("adds jitter from the injected rng, never above 25%", async () => {
    make(server.token, () => 0.999).start();
    await server.waitForStreams(1);
    server.stream.end();
    await clock.waitForTimer("reconnect");
    expect(reconnectDelay()).toBe(1000 + Math.floor(0.999 * 250));
  });

  it("resets the backoff after a connection that stayed up 30 s or more", async () => {
    make().start();
    await server.waitForStreams(1);
    server.stream.end();
    await clock.fire("reconnect"); // 1 s
    await server.waitForStreams(2);
    server.stream.end();
    await clock.waitForTimer("reconnect");
    expect(reconnectDelay()).toBe(2000);
    await clock.fire("reconnect");
    await server.waitForStreams(3);
    server.stream.hello();
    await log.waitFor("conectado");
    await clock.advance(31_000);
    server.stream.end();
    await clock.waitForTimer("reconnect");
    expect(reconnectDelay()).toBe(1000);
  });

  it("does not reset the backoff for a connection that dies within 30 s", async () => {
    make().start();
    await server.waitForStreams(1);
    server.stream.hello();
    await clock.advance(29_000);
    server.stream.end();
    await clock.fire("reconnect");
    await server.waitForStreams(2);
    server.stream.end();
    await clock.waitForTimer("reconnect");
    expect(reconnectDelay()).toBe(2000);
  });

  it("treats a 5xx like a network error (backoff, keeps trying)", async () => {
    server.streamPlan = [{ status: 503 }, { status: 503 }];
    make().start();
    await server.waitForStreamRequests(1);
    await clock.waitForTimer("reconnect");
    expect(reconnectDelay()).toBe(1000);
    await clock.fire("reconnect");
    await server.waitForStreamRequests(2);
    await clock.waitForTimer("reconnect");
    expect(reconnectDelay()).toBe(2000);
    await clock.fire("reconnect");
    await server.waitForStreams(1);
  });

  it("reconnects when the server goes silent (no ping for 75 s)", async () => {
    make().start();
    await server.waitForStreams(1);
    server.stream.hello();
    await log.waitFor("conectado");
    await clock.advance(74_000);
    expect(server.streams).toHaveLength(1);
    await clock.advance(1_000);
    await clock.waitForTimer("reconnect");
    expect(log.has("sin señal")).toBe(true);
    await clock.fire("reconnect");
    await server.waitForStreams(2);
  });

  it("a ping resets the silence watchdog", async () => {
    make().start();
    await server.waitForStreams(1);
    await clock.advance(60_000);
    server.stream.sendRaw(": ping\n\n");
    await settle();
    await waitUntil(() => clock.pending("idle").some((t) => t.ms > 70_000), [clock], "watchdog re-armed");
    await clock.advance(60_000);
    expect(server.streams).toHaveLength(1);
  });
});

describe("StreamClient: replaced", () => {
  it("does NOT reconnect at once: logs a clear error and waits 60 s", async () => {
    make().start();
    await server.waitForStreams(1);
    server.stream.hello();
    server.stream.replaced();
    await log.waitFor("Otro agente");
    server.stream.end();
    await clock.waitForTimer("reconnect");
    expect(reconnectDelay()).toBe(60_000);
    expect(log.entries.some((e) => e.level === "error" && e.msg.includes("Otro agente"))).toBe(true);
    await clock.advance(59_000);
    expect(server.streamRequests).toHaveLength(1);
    await clock.advance(1_000);
    await server.waitForStreams(2);
  });

  it("waits 60 s even if the server never closes the stream afterwards", async () => {
    make().start();
    await server.waitForStreams(1);
    server.stream.replaced();
    await clock.waitForTimer("reconnect");
    expect(reconnectDelay()).toBe(60_000);
    await waitUntil(() => server.streams[0].closed, [server], "client closing the replaced stream");
  });
});

describe("StreamClient: 401", () => {
  const MESSAGE = "Token inválido o rotado: generá uno nuevo en Admin → Estaciones";

  it("backs off 5 s doubling up to 5 minutes, logs the clear message, and recovers when the token works", async () => {
    server.streamPlan = Array.from({ length: 8 }, () => ({ status: 401 }));
    make().start();
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      await server.waitForStreamRequests(i + 1);
      await clock.waitForTimer("reconnect");
      delays.push(reconnectDelay());
      await clock.fire("reconnect");
    }
    expect(delays).toEqual([5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000]);
    expect(log.count(MESSAGE)).toBeGreaterThanOrEqual(8);
    expect(log.entries.find((e) => e.msg.includes(MESSAGE))?.level).toBe("error");
    await server.waitForStreams(1); // the plan is exhausted: the token is accepted again
    server.stream.hello();
    await log.waitFor("conectado");
    server.stream.end();
    await clock.waitForTimer("reconnect");
    expect(reconnectDelay()).toBe(1000); // the 401 streak is gone
  });

  it("a wrong token against the real auth check gets the same treatment, and the token is never logged", async () => {
    const wrong = "bhst_" + "W".repeat(43);
    make(wrong).start();
    await server.waitForStreamRequests(1);
    await clock.waitForTimer("reconnect");
    expect(reconnectDelay()).toBe(5000);
    expect(log.lines.join("\n")).not.toContain(wrong);
    expect(log.has(MESSAGE)).toBe(true);
  });
});

describe("StreamClient: 429", () => {
  it("honors Retry-After (seconds)", async () => {
    server.streamPlan = [{ status: 429, headers: { "retry-after": "42" } }];
    make().start();
    await server.waitForStreamRequests(1);
    await clock.waitForTimer("reconnect");
    expect(reconnectDelay()).toBe(42_000);
    await clock.fire("reconnect");
    await server.waitForStreams(1);
  });

  it("caps an absurd Retry-After at 10 minutes and defaults to 30 s when absent", async () => {
    server.streamPlan = [{ status: 429, headers: { "retry-after": "99999" } }, { status: 429 }];
    make().start();
    await server.waitForStreamRequests(1);
    await clock.waitForTimer("reconnect");
    expect(reconnectDelay()).toBe(600_000);
    await clock.fire("reconnect");
    await server.waitForStreamRequests(2);
    await clock.waitForTimer("reconnect");
    expect(reconnectDelay()).toBe(30_000);
  });
});

describe("StreamClient: stop", () => {
  it("stop() aborts the open stream, cancels timers and makes no further requests", async () => {
    const c = make();
    c.start();
    await server.waitForStreams(1);
    await c.stop();
    await waitUntil(() => server.streams[0].closed, [server], "stream closed");
    expect(clock.pending("reconnect")).toEqual([]);
    expect(clock.pending("idle")).toEqual([]);
    expect(server.streamRequests).toHaveLength(1);
    expect(c.connected).toBe(false);
  });

  it("stop() while waiting to reconnect ends the loop", async () => {
    const c = make();
    c.start();
    await server.waitForStreams(1);
    server.stream.end();
    await clock.waitForTimer("reconnect");
    await c.stop();
    expect(clock.pending("reconnect")).toEqual([]);
    expect(server.streamRequests).toHaveLength(1);
  });
});
