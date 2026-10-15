import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { rotateStationToken } from "@/lib/stations/admin";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { resetAgentRateLimit } from "./agent-rate-limit";
import { createAckHandler, createHeartbeatHandler } from "./agent-routes";

const db = () => testDb();
let fx: Fx;
let orderId: number;
let tokenA: string;
let tokenB: string;

const ack = createAckHandler();
const heartbeat = createHeartbeatHandler();

function post(path: string, headers: Record<string, string>, body?: string) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "x-forwarded-for": "9.9.9.9", ...headers },
    ...(body === undefined ? {} : { body }),
  });
}
const callAck = (id: string | number, token: string | null, body: unknown, rawBody?: string) =>
  ack(
    post(`/api/agent/jobs/${id}/ack`, { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, rawBody ?? JSON.stringify(body)),
    { params: Promise.resolve({ id: String(id) }) },
  );

type Over = Partial<typeof s.printJobs.$inferInsert>;
async function addJob(over: Over = {}) {
  const [row] = await db()
    .insert(s.printJobs)
    .values({ orderId, stationId: fx.stationId, type: "kitchen", payload: { blocks: [{ type: "cut" }] }, ...over })
    .returning();
  return row;
}
const job = async (id: number) => (await db().select().from(s.printJobs).where(eq(s.printJobs.id, id)))[0];
const station = async (id: number) => (await db().select().from(s.stations).where(eq(s.stations.id, id)))[0];

beforeEach(async () => {
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
afterAll(closeDb);

describe("POST /api/agent/jobs/[id]/ack", () => {
  it("answers the uniform 401 without valid credentials and never touches the job", async () => {
    const j = await addJob({ status: "printing", attempts: 1, claimedAt: new Date() });
    const bodies = [];
    for (const token of [null, "bhst_nope", `bhst_${"Z".repeat(43)}`]) {
      const res = await callAck(j.id, token, { status: "done" });
      bodies.push([res.status, await res.text()]);
    }
    expect(bodies).toEqual(Array(3).fill([401, '{"error":"unauthorized"}']));
    expect((await job(j.id)).status).toBe("printing");
  });

  it("answers 429 once the bad-auth budget is spent, while a valid token still works", async () => {
    const j = await addJob({ status: "printing", attempts: 1, claimedAt: new Date() });
    for (let i = 0; i < 30; i++) expect((await callAck(j.id, "bhst_x", { status: "done" })).status).toBe(401);
    const res = await callAck(j.id, "bhst_x", { status: "done" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).not.toBeNull();
    expect((await callAck(j.id, tokenA, { status: "done" })).status).toBe(200);
  });

  it("done: 200 {ok,status}, printed_at set, idempotent on the second call", async () => {
    const j = await addJob({ status: "printing", attempts: 1, claimedAt: new Date() });
    const r1 = await callAck(j.id, tokenA, { status: "done" });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ ok: true, status: "done" });
    const row = await job(j.id);
    expect(row.status).toBe("done");
    expect(row.printedAt).not.toBeNull();
    const r2 = await callAck(j.id, tokenA, { status: "done" });
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual({ ok: true, status: "done" });
    expect((await job(j.id)).printedAt!.getTime()).toBe(row.printedAt!.getTime());
  });

  it("done is accepted after a timeout requeue (pending) and after a final failure", async () => {
    const p = await addJob({ status: "pending", attempts: 1 });
    const f = await addJob({ status: "failed", attempts: 3, error: "sin confirmación de la impresora" });
    for (const j of [p, f]) {
      const res = await callAck(j.id, tokenA, { status: "done" });
      expect(await res.json()).toEqual({ ok: true, status: "done" });
      expect(await job(j.id)).toMatchObject({ status: "done", error: null });
    }
  });

  it("failed: attempts < 3 -> pending (error stored); attempts 3 -> final failed; control chars stripped, length capped", async () => {
    const retry = await addJob({ status: "printing", attempts: 1, claimedAt: new Date() });
    const r1 = await callAck(retry.id, tokenA, { status: "failed", error: "sin\npapel\u0000" + "x".repeat(400) });
    expect(await r1.json()).toEqual({ ok: true, status: "pending" });
    const stored = (await job(retry.id)).error!;
    expect(stored.startsWith("sinpapelxxx")).toBe(true);
    expect(stored).toHaveLength(300);
    const last = await addJob({ status: "printing", attempts: 3, claimedAt: new Date() });
    expect(await (await callAck(last.id, tokenA, { status: "failed", error: "apagada" })).json()).toEqual({ ok: true, status: "failed" });
    expect(await job(last.id)).toMatchObject({ status: "failed", error: "apagada" });
  });

  it("failed for a job that is not printing is 409 not_printing", async () => {
    const j = await addJob({ status: "done" });
    const res = await callAck(j.id, tokenA, { status: "failed", error: "x" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_printing" });
    expect((await job(j.id)).status).toBe("done");
  });

  it("another station's job and unknown or malformed ids are the same 404", async () => {
    const mine = await addJob({ stationId: fx.otherStationId, status: "printing", attempts: 1, claimedAt: new Date() });
    const seen = [];
    for (const id of [mine.id, 999_999, "abc", "0", "-1", "1.5", "99999999999999999999", "1e3"]) {
      const res = await callAck(id, tokenA, { status: "done" });
      seen.push([res.status, await res.text()]);
    }
    expect(seen).toEqual(Array(8).fill([404, '{"error":"not_found"}']));
    expect((await job(mine.id)).status).toBe("printing");
    // and the owner can ack it
    expect((await callAck(mine.id, tokenB, { status: "done" })).status).toBe(200);
  });

  it("invalid bodies are 400 and change nothing", async () => {
    const j = await addJob({ status: "printing", attempts: 1, claimedAt: new Date() });
    const cases: [unknown, string?][] = [
      [{ status: "pending" }],
      [{}],
      [[]],
      [null],
      [{ status: "failed", error: 7 }],
      [{ status: "failed", error: "x".repeat(2001) }],
      [undefined, ""],
      [undefined, "not json"],
      [undefined, "{"],
      [undefined, JSON.stringify({ status: "done", pad: "x".repeat(10_000) })],
    ];
    for (const [body, raw] of cases) {
      const res = await callAck(j.id, tokenA, body, raw);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_body" });
    }
    expect((await job(j.id)).status).toBe("printing");
  });

  it("refreshes the station's last_seen_at", async () => {
    const j = await addJob({ status: "printing", attempts: 1, claimedAt: new Date() });
    expect((await station(fx.stationId)).lastSeenAt).toBeNull();
    await callAck(j.id, tokenA, { status: "done" });
    expect((await station(fx.stationId)).lastSeenAt).not.toBeNull();
    expect((await station(fx.otherStationId)).lastSeenAt).toBeNull();
  });

  it("sets no cookies and no CORS headers", async () => {
    const j = await addJob({ status: "printing", attempts: 1, claimedAt: new Date() });
    const res = await callAck(j.id, tokenA, { status: "done" });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST /api/agent/heartbeat", () => {
  it("200 {ok, serverTime} with an empty body and updates last_seen_at", async () => {
    const res = await heartbeat(post("/api/agent/heartbeat", { authorization: `Bearer ${tokenA}` }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; serverTime: string };
    expect(body.ok).toBe(true);
    expect(Number.isNaN(Date.parse(body.serverTime))).toBe(false);
    expect((await station(fx.stationId)).lastSeenAt).not.toBeNull();
    expect((await station(fx.otherStationId)).lastSeenAt).toBeNull();
  });

  it("ignores any body", async () => {
    const res = await heartbeat(post("/api/agent/heartbeat", { authorization: `Bearer ${tokenA}` }, "garbage{"));
    expect(res.status).toBe(200);
  });

  it("uniform 401 and shared rate limit", async () => {
    const res = await heartbeat(post("/api/agent/heartbeat", {}));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect((await station(fx.stationId)).lastSeenAt).toBeNull();
    for (let i = 0; i < 30; i++) await heartbeat(post("/api/agent/heartbeat", { authorization: "Bearer x" }));
    expect((await heartbeat(post("/api/agent/heartbeat", { authorization: "Bearer x" }))).status).toBe(429);
  });
});
