import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AckDelivery, AgentApi } from "./ack";
import { createLogger } from "./logger";
import { StateStore } from "./state";
import { CaptureLog, FakeClock, FakeServer, settle, tmpDir, waitUntil } from "./testing/support";

let server: FakeServer;
let dir: string;
let clock: FakeClock;
let log: CaptureLog;
beforeEach(async () => {
  server = await FakeServer.start();
  dir = tmpDir();
  clock = new FakeClock();
  log = new CaptureLog();
});
afterEach(async () => {
  await server.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

const api = (token = server.token) => new AgentApi({ serverUrl: server.url, token, timeoutMs: 2000 });
const delivery = (state = StateStore.load(dir)) =>
  new AckDelivery({ api: api(), state, clock, rng: () => 0, logger: createLogger({ level: "debug", sinks: [log.sink] }) });

describe("AgentApi", () => {
  it("classifies ack responses", async () => {
    expect(await api().postAck(1, "done")).toEqual({ kind: "delivered" });
    expect(server.acks).toEqual([{ jobId: 1, status: "done" }]);
    for (const status of [400, 404, 409]) {
      server.ackBehaviour = () => ({ status });
      expect(await api().postAck(2, "failed", "x")).toEqual({ kind: "rejected", httpStatus: status });
    }
    server.ackBehaviour = () => ({ status: 429 });
    expect(await api().postAck(3, "done")).toEqual({ kind: "retry", reason: "429", retryAfterMs: 7000 });
    server.ackBehaviour = () => ({ status: 500 });
    expect(await api().postAck(3, "done")).toMatchObject({ kind: "retry", reason: "500" });
    server.ackBehaviour = () => "drop";
    expect(await api().postAck(3, "done")).toMatchObject({ kind: "retry", reason: "network" });
    server.ackBehaviour = () => undefined;
    expect(await api("bhst_" + "X".repeat(43)).postAck(3, "done")).toMatchObject({ kind: "retry", reason: "401" });
  });

  it("sends the error text only with failed acks", async () => {
    await api().postAck(1, "failed", "Sin papel");
    expect(server.acks).toEqual([{ jobId: 1, status: "failed", error: "Sin papel" }]);
  });

  it("heartbeat returns the server time, or the failure kind", async () => {
    expect(await api().heartbeat()).toMatchObject({ ok: true });
    expect(await api("bhst_" + "X".repeat(43)).heartbeat()).toEqual({ ok: false, reason: "unauthorized" });
    await server.stop();
    expect(await api().heartbeat()).toMatchObject({ ok: false, reason: "network" });
    server = await FakeServer.start();
  });
});

describe("AckDelivery", () => {
  it("delivers an ack right away and clears it from the persisted queue", async () => {
    const state = StateStore.load(dir);
    const d = delivery(state);
    d.submit({ jobId: 5, status: "done" });
    await server.waitForAcks(1);
    await d.idle();
    expect(server.acks).toEqual([{ jobId: 5, status: "done" }]);
    expect(state.pendingAcks()).toEqual([]);
    expect(StateStore.load(dir).pendingAcks()).toEqual([]);
  });

  it("keeps an undelivered ack on disk and retries with backoff 1s, 2s, 4s ... until delivered", async () => {
    server.ackBehaviour = (_a, n) => (n <= 3 ? "drop" : undefined);
    const state = StateStore.load(dir);
    const d = delivery(state);
    d.submit({ jobId: 5, status: "done" });
    await clock.waitForTimer("ack-retry");
    expect(StateStore.load(dir).pendingAcks().map((a) => a.jobId)).toEqual([5]);
    expect(clock.pending("ack-retry")[0].ms).toBe(1000);
    await clock.fire("ack-retry");
    await waitUntil(() => server.ackRequests >= 2, [server], "2nd attempt");
    await clock.waitForTimer("ack-retry");
    expect(clock.pending("ack-retry")[0].ms).toBe(2000);
    await clock.fire("ack-retry");
    await clock.waitForTimer("ack-retry");
    expect(clock.pending("ack-retry")[0].ms).toBe(4000);
    await clock.fire("ack-retry");
    await server.waitForAcks(1);
    await d.idle();
    expect(StateStore.load(dir).pendingAcks()).toEqual([]);
    expect(clock.pending("ack-retry")).toEqual([]);
  });

  it("caps the retry delay at 30 s plus jitter", async () => {
    server.ackBehaviour = () => "drop";
    const d = delivery();
    d.submit({ jobId: 1, status: "done" });
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      await clock.waitForTimer("ack-retry");
      delays.push(clock.pending("ack-retry")[0].ms);
      await clock.fire("ack-retry");
      await d.idle();
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    await d.stop();
  });

  it("survives a restart: pending acks are delivered by a new instance on start()", async () => {
    server.ackBehaviour = () => "drop";
    const first = delivery();
    first.submit({ jobId: 8, status: "done" });
    await clock.waitForTimer("ack-retry");
    await first.stop();
    server.ackBehaviour = () => undefined;
    const second = delivery(StateStore.load(dir));
    second.start();
    await server.waitForAcks(1);
    expect(server.acks).toEqual([{ jobId: 8, status: "done" }]);
    await second.idle();
    expect(StateStore.load(dir).pendingAcks()).toEqual([]);
  });

  it("drops an ack the server refuses for good (400/404/409) instead of retrying forever", async () => {
    server.ackBehaviour = () => ({ status: 404 });
    const d = delivery();
    d.submit({ jobId: 3, status: "done" });
    await d.idle();
    expect(StateStore.load(dir).pendingAcks()).toEqual([]);
    expect(clock.pending("ack-retry")).toEqual([]);
    expect(log.has("descartado")).toBe(true);
  });

  it("honors Retry-After on 429", async () => {
    server.ackBehaviour = (_a, n) => (n === 1 ? { status: 429 } : undefined);
    const d = delivery();
    d.submit({ jobId: 3, status: "done" });
    await clock.waitForTimer("ack-retry");
    expect(clock.pending("ack-retry")[0].ms).toBe(7000);
    await clock.fire("ack-retry");
    await server.waitForAcks(1);
    await d.idle();
  });

  it("keeps acks and retries on 401 (token rotated meanwhile)", async () => {
    server.ackBehaviour = (_a, n) => (n === 1 ? { status: 401 } : undefined);
    const d = delivery();
    d.submit({ jobId: 3, status: "done" });
    await clock.waitForTimer("ack-retry");
    expect(StateStore.load(dir).pendingAcks()).toHaveLength(1);
    await clock.fire("ack-retry");
    await server.waitForAcks(1);
  });

  it("delivers several acks oldest first, one at a time", async () => {
    const d = delivery();
    d.submit({ jobId: 1, status: "done" });
    d.submit({ jobId: 2, status: "failed", error: "x" });
    d.submit({ jobId: 3, status: "done" });
    await server.waitForAcks(3);
    expect(server.acks.map((a) => a.jobId)).toEqual([1, 2, 3]);
  });

  it("stop() waits for the in-flight attempt and cancels the retry timer", async () => {
    server.ackBehaviour = () => "drop";
    const d = delivery();
    d.submit({ jobId: 1, status: "done" });
    await clock.waitForTimer("ack-retry");
    await d.stop();
    expect(clock.pending("ack-retry")).toEqual([]);
    await settle();
  });

  it("never logs the token", async () => {
    server.ackBehaviour = () => "drop";
    const d = delivery();
    d.submit({ jobId: 1, status: "failed", error: "x" });
    await clock.waitForTimer("ack-retry");
    expect(log.lines.join("\n")).not.toContain(server.token);
    await d.stop();
  });
});
