import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { listenerCount, publish } from "@/lib/events/bus";
import { rotateStationToken } from "@/lib/stations/admin";
import { SseReader } from "@/test-support/sse";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { resetAgentRateLimit } from "./agent-rate-limit";
import { agentStreamCount, resetAgentRegistry } from "./agent-registry";
import { createAgentStreamHandler, type AgentStreamOptions } from "./agent-stream";

const db = () => testDb();
let fx: Fx;
let orderId: number;
let tokenA: string;
let tokenB: string;

const aborts: AbortController[] = [];
const readers: SseReader[] = [];
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

function request(headers: Record<string, string>, ac = new AbortController()) {
  aborts.push(ac);
  return { req: new Request("http://localhost/api/agent/stream", { headers: { "x-forwarded-for": "9.9.9.9", ...headers }, signal: ac.signal }), ac };
}

async function connect(token: string, opts: AgentStreamOptions = {}) {
  const handler = createAgentStreamHandler({ tickMs: 60_000, pingMs: 60_000, ...opts });
  const { req, ac } = request(bearer(token));
  const res = await handler(req);
  expect(res.status).toBe(200);
  const reader = new SseReader(res);
  readers.push(reader);
  return { res, reader, ac };
}

type Over = Partial<typeof s.printJobs.$inferInsert>;
async function addJob(over: Over = {}) {
  const [row] = await db()
    .insert(s.printJobs)
    .values({ orderId, stationId: fx.stationId, type: "kitchen", payload: { blocks: [{ type: "text", text: "PEDIDO" }, { type: "cut" }] }, ...over })
    .returning();
  return row;
}
const job = async (id: number) => (await db().select().from(s.printJobs).where(eq(s.printJobs.id, id)))[0];
const station = async (id: number) => (await db().select().from(s.stations).where(eq(s.stations.id, id)))[0];
/**
 * The real test db with hooks: a hook for `execute`/`transaction` runs first; a returned promise is
 * awaited (a rejection fails the call), then the real method runs.
 */
function proxyDb(hooks: Partial<Record<"execute" | "transaction", () => Promise<unknown> | undefined>>) {
  const real = db();
  return new Proxy(real, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      const hook = hooks[prop as "execute" | "transaction"];
      if (typeof v !== "function" || !hook) return typeof v === "function" ? v.bind(target) : v;
      return async (...args: unknown[]) => {
        await hook();
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function eventually(pred: () => Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return;
    await sleep(10);
  }
  throw new Error("condition not met in time");
}

beforeEach(async () => {
  resetAgentRegistry();
  resetAgentRateLimit();
  await resetDb();
  fx = await seedMenuAndStaff();
  orderId = (await placeWebOrder(fx)).id;
  const a = await rotateStationToken(db(), fx.stationId);
  const b = await rotateStationToken(db(), fx.otherStationId);
  if (!a.ok || !b.ok) throw new Error("fixture");
  tokenA = a.data.token;
  tokenB = b.data.token;
});
afterEach(async () => {
  for (const ac of aborts.splice(0)) ac.abort();
  await Promise.all(readers.splice(0).map((r) => r.cancel()));
});
afterAll(closeDb);

describe("authentication", () => {
  it("every failure kind answers the identical 401 (status, body, relevant headers)", async () => {
    const handler = createAgentStreamHandler();
    const wellFormedUnknown = `bhst_${"Z".repeat(43)}`;
    const old = tokenA;
    const rot = await rotateStationToken(db(), fx.stationId);
    if (!rot.ok) throw new Error("fixture");
    const cases: Record<string, string>[] = [
      {},
      { authorization: "" },
      { authorization: "Bearer" },
      { authorization: "Bearer garbage" },
      { authorization: `Bearer ${wellFormedUnknown}` },
      { authorization: `Bearer ${old}` }, // rotated away
      { authorization: `Basic ${rot.data.token}` },
      { authorization: rot.data.token },
    ];
    const seen = [];
    for (const headers of cases) {
      const res = await handler(request(headers).req);
      seen.push({
        status: res.status,
        body: await res.text(),
        type: res.headers.get("content-type"),
        cache: res.headers.get("cache-control"),
        cookie: res.headers.get("set-cookie"),
        cors: res.headers.get("access-control-allow-origin"),
      });
    }
    expect(seen[0]).toEqual({ status: 401, body: '{"error":"unauthorized"}', type: "application/json", cache: "no-store", cookie: null, cors: null });
    for (const r of seen) expect(r).toEqual(seen[0]);
  });

  it("answers 429 with Retry-After after 30 bad auths per IP; valid tokens are unaffected and never spend the budget", async () => {
    const handler = createAgentStreamHandler({ tickMs: 60_000, pingMs: 60_000 });
    // 40 successful connections first: they must not consume anything
    for (let i = 0; i < 40; i++) {
      const { req, ac } = request(bearer(tokenA), new AbortController());
      const res = await handler(req);
      expect(res.status).toBe(200);
      ac.abort();
    }
    for (let i = 0; i < 30; i++) {
      const res = await handler(request({ authorization: "Bearer nope" }).req);
      expect(res.status).toBe(401);
    }
    const blocked = await handler(request({ authorization: "Bearer nope" }).req);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too_many_attempts" });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // a well-formed but unknown token from the same IP is limited too
    expect((await handler(request(bearer(`bhst_${"Q".repeat(43)}`)).req)).status).toBe(429);
    // a legitimate agent behind the same IP still connects
    expect((await handler(request(bearer(tokenA)).req)).status).toBe(200);
    // another IP is not affected
    const other = await handler(request({ authorization: "Bearer nope", "x-forwarded-for": "8.8.8.8" }).req);
    expect(other.status).toBe(401);
  });
});

describe("stream basics", () => {
  it("sends the SSE headers, retry, then hello with the station and protocol constants", async () => {
    const { res, reader } = await connect(tokenA);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const first = await reader.next();
    expect(first?.raw).toBe("retry: 3000");
    const hello = await reader.next();
    expect(hello?.event).toBe("hello");
    expect(hello?.data).toMatchObject({ stationId: fx.stationId, stationName: "Mostrador 1", protocol: 1, maxAttempts: 3, stuckAfterMs: 30000 });
    expect(Number.isNaN(Date.parse((hello!.data as { serverTime: string }).serverTime))).toBe(false);
  });

  it("updates stations.last_seen_at on connect", async () => {
    expect((await station(fx.stationId)).lastSeenAt).toBeNull();
    const before = Date.now();
    const { reader } = await connect(tokenA);
    await reader.event("hello");
    await eventually(async () => (await station(fx.stationId)).lastSeenAt !== null);
    expect((await station(fx.stationId)).lastSeenAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect((await station(fx.otherStationId)).lastSeenAt).toBeNull();
  });

  it("the tick keeps refreshing last_seen_at", async () => {
    const { reader } = await connect(tokenA, { tickMs: 40 });
    await reader.event("hello");
    await eventually(async () => (await station(fx.stationId)).lastSeenAt !== null);
    const first = (await station(fx.stationId)).lastSeenAt!.getTime();
    await eventually(async () => (await station(fx.stationId)).lastSeenAt!.getTime() > first);
  });

  it("emits a ': ping' comment at the injected interval", async () => {
    const { reader } = await connect(tokenA, { pingMs: 30 });
    const ping = await reader.until((f) => f.comment === "ping");
    expect(ping.raw).toBe(": ping");
  });
});

describe("delivering jobs", () => {
  it("delivers this station's pending jobs on connect, oldest first, with the stored document", async () => {
    const doc1 = { blocks: [{ type: "text", text: "COCINA ÑU", bold: true, size: 2, align: "center" }, { type: "cut" }] };
    const a = await addJob({ type: "kitchen", payload: doc1 });
    await addJob({ stationId: fx.otherStationId, type: "kitchen" });
    const b = await addJob({ type: "ticket" });
    const { reader } = await connect(tokenA);
    const jobs = (await reader.events("job", 2)) as { id: number; type: string; attempts: number; createdAt: string; document: unknown }[];
    expect(jobs.map((j) => j.id)).toEqual([a.id, b.id]);
    expect(jobs[0]).toEqual({ id: a.id, type: "kitchen", attempts: 1, createdAt: a.createdAt.toISOString(), document: doc1 });
    expect(jobs[1].type).toBe("ticket");
    expect((await job(a.id)).status).toBe("printing");
    // the other station's job is untouched
    expect(await reader.noEventWithin("job", 150)).toBe(true);
    const rows = await db().select().from(s.printJobs).where(eq(s.printJobs.stationId, fx.otherStationId));
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("a job created after connecting is delivered right away on the bus event (no waiting for the tick)", async () => {
    const { reader } = await connect(tokenA);
    await reader.event("hello");
    const a = await addJob();
    const t0 = Date.now();
    publish("print_job_created", { jobId: a.id, stationId: fx.stationId });
    const f = await reader.event("job", 1000);
    expect((f.data as { id: number }).id).toBe(a.id);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("ignores bus events of other stations", async () => {
    const { reader } = await connect(tokenA);
    await reader.event("hello");
    const other = await addJob({ stationId: fx.otherStationId });
    publish("print_job_created", { jobId: other.id, stationId: fx.otherStationId });
    expect(await reader.noEventWithin("job", 150)).toBe(true);
    expect((await job(other.id)).status).toBe("pending");
  });

  it("the tick picks up pending jobs even when no bus event arrives", async () => {
    const { reader } = await connect(tokenA, { tickMs: 40 });
    await reader.event("hello");
    const a = await addJob();
    expect(((await reader.event("job")).data as { id: number }).id).toBe(a.id);
  });

  it("the tick requeues stuck jobs and re-delivers them with attempts+1", async () => {
    const { reader } = await connect(tokenA, { tickMs: 40 });
    await reader.event("hello");
    const stuck = await addJob({ status: "printing", attempts: 1, claimedAt: new Date(Date.now() - 31_000) });
    const f = await reader.event("job");
    expect(f.data).toMatchObject({ id: stuck.id, attempts: 2 });
  });

  it("a job claimed by a previous connection that never acked is NOT re-delivered before the stuck timeout", async () => {
    const a = await addJob();
    const first = await connect(tokenA);
    expect(((await first.reader.event("job")).data as { id: number }).id).toBe(a.id);
    first.ac.abort();
    const second = await connect(tokenA);
    await second.reader.event("hello");
    expect(await second.reader.noEventWithin("job", 200)).toBe(true);
    expect(await job(a.id)).toMatchObject({ status: "printing", attempts: 1 });
  });

  it("claims at most 20 jobs per claim; the rest wait for the next tick", async () => {
    for (let i = 0; i < 25; i++) await addJob();
    const { reader } = await connect(tokenA);
    expect(await reader.events("job", 20)).toHaveLength(20);
    expect(await reader.noEventWithin("job", 150)).toBe(true);
    const rows = await db().select().from(s.printJobs).where(eq(s.printJobs.status, "pending"));
    expect(rows).toHaveLength(5);
  });

  it("does not claim more than the stream can take while the client is slow, then delivers the rest exactly once as it drains", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 30; i++) ids.push((await addJob()).id);
    const { reader } = await connect(tokenA, { queueSize: 6, tickMs: 60_000 });
    // The client is not reading: the server may only have claimed what fits.
    await eventually(async () => (await db().select().from(s.printJobs).where(eq(s.printJobs.status, "printing"))).length > 0);
    await sleep(150);
    const claimedWhileStalled = (await db().select().from(s.printJobs).where(eq(s.printJobs.status, "printing"))).length;
    expect(claimedWhileStalled).toBeGreaterThan(0);
    expect(claimedWhileStalled).toBeLessThanOrEqual(8);
    // Reading drains the queue, which lets the stream claim the remainder.
    const got = (await reader.events("job", 30, 5000)) as { id: number }[];
    expect(got.map((j) => j.id)).toEqual(ids);
    expect(new Set(got.map((j) => j.id)).size).toBe(30);
  });

  it("an invalid stored document is NOT sent: the job is marked failed with 'payload inválido' and the others still flow", async () => {
    const bad = await addJob({ payload: { blocks: [{ type: "image", src: "http://evil" }] } });
    const good = await addJob();
    const { reader } = await connect(tokenA);
    const f = await reader.event("job");
    expect((f.data as { id: number }).id).toBe(good.id);
    await eventually(async () => (await job(bad.id)).status === "failed");
    expect(await job(bad.id)).toMatchObject({ status: "failed", error: "payload inválido" });
    expect(reader.seen.filter((x) => x.event === "job")).toHaveLength(1);
  });

  it("DB errors during a tick keep the stream alive (fixed log, retried next tick)", async () => {
    const gate = { fail: true };
    const flaky = proxyDb({ execute: () => (gate.fail ? Promise.reject(new Error("boom")) : undefined), transaction: () => (gate.fail ? Promise.reject(new Error("boom")) : undefined) });
    const { reader } = await connect(tokenA, { tickMs: 40, db: flaky });
    await reader.event("hello");
    const a = await addJob();
    await sleep(150);
    expect((await job(a.id)).status).toBe("pending");
    gate.fail = false;
    expect(((await reader.event("job")).data as { id: number }).id).toBe(a.id);
  });
});

describe("token revocation", () => {
  it("rotating the station token ends an already-open stream at the next tick; nothing is delivered after that", async () => {
    const { reader } = await connect(tokenA, { tickMs: 40 });
    await reader.event("hello");
    expect(agentStreamCount()).toBe(1);
    const rot = await rotateStationToken(db(), fx.stationId);
    if (!rot.ok) throw new Error("fixture");
    expect(await reader.waitEnd()).toBe(true);
    expect(agentStreamCount()).toBe(0);
    const a = await addJob();
    publish("print_job_created", { jobId: a.id, stationId: fx.stationId });
    await sleep(150);
    expect((await job(a.id)).status).toBe("pending");
    expect(reader.seen.filter((f) => f.event === "job")).toHaveLength(0);
  });
});

describe("one stream per station", () => {
  it("a second connection for the same station replaces the first: it gets 'replaced' and ends; only the new one receives jobs", async () => {
    const first = await connect(tokenA);
    await first.reader.event("hello");
    expect(agentStreamCount()).toBe(1);
    const second = await connect(tokenA);
    await second.reader.event("hello");
    await first.reader.event("replaced");
    expect(await first.reader.waitEnd()).toBe(true);
    expect(agentStreamCount()).toBe(1);

    const a = await addJob();
    publish("print_job_created", { jobId: a.id, stationId: fx.stationId });
    expect(((await second.reader.event("job")).data as { id: number }).id).toBe(a.id);
    expect(first.reader.seen.filter((f) => f.event === "job")).toHaveLength(0);
    expect((await job(a.id)).attempts).toBe(1);
  });

  it("different stations stream independently", async () => {
    const a = await connect(tokenA);
    const b = await connect(tokenB);
    await a.reader.event("hello");
    await b.reader.event("hello");
    expect(agentStreamCount()).toBe(2);
    const jb = await addJob({ stationId: fx.otherStationId });
    publish("print_job_created", { jobId: jb.id, stationId: fx.otherStationId });
    expect(((await b.reader.event("job")).data as { id: number }).id).toBe(jb.id);
    expect(await a.reader.noEventWithin("job", 100)).toBe(true);
    expect(await a.reader.noEventWithin("replaced", 10)).toBe(true);
  });

  it("answers 429 over the global cap, but a station may always replace its own stream", async () => {
    const handler = createAgentStreamHandler({ globalCap: 1, tickMs: 60_000, pingMs: 60_000 });
    const r1 = await handler(request(bearer(tokenA)).req);
    expect(r1.status).toBe(200);
    readers.push(new SseReader(r1));
    const r2 = await handler(request(bearer(tokenB)).req);
    expect(r2.status).toBe(429);
    expect(Number(r2.headers.get("retry-after"))).toBeGreaterThan(0);
    const r3 = await handler(request(bearer(tokenA)).req);
    expect(r3.status).toBe(200);
    readers.push(new SseReader(r3));
    expect(agentStreamCount()).toBe(1);
  });
});

describe("cleanup", () => {
  it("abort releases the bus subscriptions, the registry entry and stops every timer", async () => {
    const baseline = listenerCount();
    const { reader, ac } = await connect(tokenA, { tickMs: 20, pingMs: 20 });
    await reader.event("hello");
    expect(listenerCount()).toBeGreaterThan(baseline);
    expect(agentStreamCount()).toBe(1);
    ac.abort();
    expect(listenerCount()).toBe(baseline);
    expect(agentStreamCount()).toBe(0);
    expect(await reader.waitEnd()).toBe(true);
    // nothing claims anymore: neither the tick nor the bus
    const a = await addJob();
    publish("print_job_created", { jobId: a.id, stationId: fx.stationId });
    await sleep(150);
    expect((await job(a.id)).status).toBe("pending");
  });

  it("the client cancelling the body releases everything too", async () => {
    const baseline = listenerCount();
    const { reader } = await connect(tokenA);
    await reader.event("hello");
    await reader.cancel();
    await eventually(async () => agentStreamCount() === 0);
    expect(listenerCount()).toBe(baseline);
  });

  it("an already-aborted request leaves nothing behind", async () => {
    const baseline = listenerCount();
    const ac = new AbortController();
    ac.abort();
    const res = await createAgentStreamHandler()(request(bearer(tokenA), ac).req);
    readers.push(new SseReader(res));
    expect(agentStreamCount()).toBe(0);
    expect(listenerCount()).toBe(baseline);
  });

  it("jobs claimed while the stream was closing are handed back (attempt refunded), not left in limbo", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let claims = 0;
    const slow = proxyDb({ execute: () => (claims++ === 0 ? held : undefined) });
    const a = await addJob();
    const { reader, ac } = await connect(tokenA, { db: slow });
    await eventually(async () => claims >= 1);
    ac.abort();
    await reader.waitEnd();
    release();
    // The job is ALSO "pending" before the held claim resumes, so polling for "pending" alone passes instantly and the
    // assertion raced the claim + hand-back (it flaked as status "printing", attempts 1). Give the resumed claim time to
    // run and be handed back (a few ms of queries) before polling for the settled state.
    await sleep(400);
    await eventually(async () => (await job(a.id)).status === "pending");
    expect(await job(a.id)).toMatchObject({ status: "pending", attempts: 0, claimedAt: null });
  });
});
