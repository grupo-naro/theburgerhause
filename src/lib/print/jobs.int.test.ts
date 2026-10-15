import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { closeDb } from "@/db/client";
import * as s from "@/db/schema";
import { resetDb, testDb } from "@/db/test-utils";
import { getEnv } from "@/lib/env";
import { placeWebOrder, seedMenuAndStaff, type Fx } from "@/test-support/orders";
import { ackPrintJob, claimPendingJobs, markJobFailed, requeueStuckJobs, unclaimJobs } from "./jobs";

const db = () => testDb();
let fx: Fx;
let orderId: number;
const NOW = new Date("2026-10-15T15:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

type Over = Partial<typeof s.printJobs.$inferInsert>;
async function addJob(over: Over = {}) {
  const [row] = await db()
    .insert(s.printJobs)
    .values({ orderId, stationId: fx.stationId, type: "kitchen", payload: { blocks: [{ type: "cut" }] }, ...over })
    .returning();
  return row;
}
const job = async (id: number) => (await db().select().from(s.printJobs).where(eq(s.printJobs.id, id)))[0];
const dropTriggers = () => db().execute(sql.raw("DROP FUNCTION IF EXISTS boom_commit() CASCADE;"));

beforeEach(async () => {
  await dropTriggers();
  await resetDb();
  fx = await seedMenuAndStaff();
  orderId = (await placeWebOrder(fx)).id;
});
afterEach(dropTriggers);
afterAll(async () => {
  await dropTriggers();
  await closeDb();
});

describe("claimPendingJobs", () => {
  it("returns the oldest first and marks them printing, attempts+1, claimed_at", async () => {
    const a = await addJob({ type: "kitchen" });
    const b = await addJob({ type: "ticket" });
    const got = await claimPendingJobs(db(), fx.stationId, NOW, 20);
    expect(got.map((j) => j.id)).toEqual([a.id, b.id]);
    expect(got[0]).toMatchObject({ orderId, type: "kitchen", attempts: 1, payload: { blocks: [{ type: "cut" }] } });
    expect(got[0].createdAt).toBeInstanceOf(Date);
    const row = await job(a.id);
    expect(row).toMatchObject({ status: "printing", attempts: 1 });
    expect(row.claimedAt?.toISOString()).toBe(NOW.toISOString());
    expect(row.updatedAt.toISOString()).toBe(NOW.toISOString());
  });

  it("never claims other stations' jobs nor non-pending ones", async () => {
    await addJob({ stationId: fx.otherStationId });
    await addJob({ status: "printing", attempts: 1, claimedAt: NOW });
    await addJob({ status: "done" });
    await addJob({ status: "failed", attempts: 3 });
    expect(await claimPendingJobs(db(), fx.stationId, NOW, 20)).toEqual([]);
  });

  it("honors the limit, oldest first, and the rest stays pending", async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await addJob()).id);
    expect((await claimPendingJobs(db(), fx.stationId, NOW, 2)).map((j) => j.id)).toEqual(ids.slice(0, 2));
    expect((await claimPendingJobs(db(), fx.stationId, NOW, 20)).map((j) => j.id)).toEqual(ids.slice(2));
    expect(await claimPendingJobs(db(), fx.stationId, NOW, 20)).toEqual([]);
  });

  it("limit 0 or negative claims nothing", async () => {
    const a = await addJob();
    expect(await claimPendingJobs(db(), fx.stationId, NOW, 0)).toEqual([]);
    expect(await claimPendingJobs(db(), fx.stationId, NOW, -3)).toEqual([]);
    expect((await job(a.id)).status).toBe("pending");
  });

  it("20 parallel claimers never get the same job and together cover every job exactly once", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 40; i++) ids.push((await addJob()).id);
    const results = await Promise.all(Array.from({ length: 20 }, () => claimPendingJobs(db(), fx.stationId, NOW, 3)));
    const all = results.flat().map((j) => j.id);
    expect(new Set(all).size).toBe(all.length);
    // drain the rest, then every job was handed out exactly once
    const rest = (await claimPendingJobs(db(), fx.stationId, NOW, 100)).map((j) => j.id);
    expect([...all, ...rest].sort((x, y) => x - y)).toEqual(ids);
    const rows = await db().select().from(s.printJobs);
    expect(rows.every((r) => r.attempts === 1 && r.status === "printing")).toBe(true);
  });

  it("delivers the stored payload byte-for-byte", async () => {
    const payload = { blocks: [{ type: "text", text: 'ÑANDÚ  "q" \\   ñ 🍔', bold: true, size: 2 }, { type: "cut" }] };
    const a = await addJob({ payload });
    const [got] = await claimPendingJobs(db(), fx.stationId, NOW, 1);
    expect(JSON.stringify(got.payload)).toBe(JSON.stringify((await job(a.id)).payload));
    expect(got.payload).toEqual(payload);
  });
});

describe("unclaimJobs", () => {
  it("returns still-printing jobs claimed at that instant to pending and gives the attempt back", async () => {
    const a = await addJob();
    const [c] = await claimPendingJobs(db(), fx.stationId, NOW, 1);
    expect(await unclaimJobs(db(), [c.id], ago(1))).toBe(0); // other claim instant: untouched
    expect(await unclaimJobs(db(), [c.id], NOW)).toBe(1);
    expect(await job(a.id)).toMatchObject({ status: "pending", attempts: 0, claimedAt: null });
  });

  it("does not touch a job that was acked meanwhile", async () => {
    const a = await addJob();
    await claimPendingJobs(db(), fx.stationId, NOW, 1);
    await ackPrintJob(db(), { jobId: a.id, stationId: fx.stationId, status: "done", error: null, now: NOW });
    expect(await unclaimJobs(db(), [a.id], NOW)).toBe(0);
    expect((await job(a.id)).status).toBe("done");
  });

  it("an empty list is a no-op", async () => {
    expect(await unclaimJobs(db(), [], NOW)).toBe(0);
  });
});

describe("ackPrintJob", () => {
  const ack = (jobId: number, status: "done" | "failed", error: string | null = null, stationId = fx.stationId) =>
    ackPrintJob(db(), { jobId, stationId, status, error, now: NOW });

  it("done from printing: status, printed_at, error cleared", async () => {
    const a = await addJob({ status: "printing", attempts: 1, claimedAt: NOW, error: "viejo" });
    expect(await ack(a.id, "done")).toEqual({ kind: "ok", status: "done" });
    const row = await job(a.id);
    expect(row).toMatchObject({ status: "done", error: null });
    expect(row.printedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("done is accepted from pending (after a timeout requeue) and from a final failed", async () => {
    const p = await addJob({ status: "pending", attempts: 1 });
    const f = await addJob({ status: "failed", attempts: 3, error: "sin confirmación de la impresora" });
    expect(await ack(p.id, "done")).toEqual({ kind: "ok", status: "done" });
    expect(await ack(f.id, "done")).toEqual({ kind: "ok", status: "done" });
    expect(await job(f.id)).toMatchObject({ status: "done", error: null });
  });

  it("done is idempotent: the second one changes nothing", async () => {
    const a = await addJob({ status: "printing", attempts: 1, claimedAt: NOW });
    await ack(a.id, "done");
    const before = await job(a.id);
    const later = new Date(NOW.getTime() + 60_000);
    expect(await ackPrintJob(db(), { jobId: a.id, stationId: fx.stationId, status: "done", error: null, now: later })).toEqual({ kind: "ok", status: "done" });
    const after = await job(a.id);
    expect(after.printedAt?.toISOString()).toBe(before.printedAt?.toISOString());
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
  });

  it("failed with attempts < 3 goes back to pending with the error stored", async () => {
    for (const attempts of [1, 2]) {
      const a = await addJob({ status: "printing", attempts, claimedAt: NOW });
      expect(await ack(a.id, "failed", "sin papel")).toEqual({ kind: "ok", status: "pending" });
      expect(await job(a.id)).toMatchObject({ status: "pending", attempts, error: "sin papel" });
    }
  });

  it("failed with attempts 3 is final", async () => {
    const a = await addJob({ status: "printing", attempts: 3, claimedAt: NOW });
    expect(await ack(a.id, "failed", "impresora apagada")).toEqual({ kind: "ok", status: "failed" });
    expect(await job(a.id)).toMatchObject({ status: "failed", error: "impresora apagada" });
  });

  it("failed without an error message stores a generic one", async () => {
    const a = await addJob({ status: "printing", attempts: 3, claimedAt: NOW });
    await ack(a.id, "failed", null);
    expect((await job(a.id)).error).toBe("error de impresión");
  });

  it("failed on a job that is not printing is refused and changes nothing", async () => {
    for (const status of ["pending", "done", "failed"] as const) {
      const a = await addJob({ status, attempts: 1 });
      expect(await ack(a.id, "failed", "x")).toEqual({ kind: "not_printing" });
      expect((await job(a.id)).status).toBe(status);
    }
  });

  it("another station's job and unknown ids are indistinguishable (not_found)", async () => {
    const a = await addJob({ stationId: fx.otherStationId, status: "printing", attempts: 1, claimedAt: NOW });
    expect(await ack(a.id, "done")).toEqual({ kind: "not_found" });
    expect(await ack(a.id, "failed", "x")).toEqual({ kind: "not_found" });
    expect(await ack(999_999, "done")).toEqual({ kind: "not_found" });
    expect((await job(a.id)).status).toBe("printing");
  });
});

describe("requeueStuckJobs", () => {
  it("boundary: claimed 29.9 s ago stays, 30.1 s ago is requeued", async () => {
    const fresh = await addJob({ status: "printing", attempts: 1, claimedAt: ago(29_900) });
    const stale = await addJob({ status: "printing", attempts: 1, claimedAt: ago(30_100) });
    const r = await requeueStuckJobs(db(), NOW);
    expect(r.map((j) => j.id)).toEqual([stale.id]);
    expect((await job(fresh.id)).status).toBe("printing");
    expect(await job(stale.id)).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("attempts 1 and 2 go back to pending (attempts kept); attempts 3 fails with the Spanish error", async () => {
    const j1 = await addJob({ status: "printing", attempts: 1, claimedAt: ago(40_000) });
    const j2 = await addJob({ status: "printing", attempts: 2, claimedAt: ago(40_000) });
    const j3 = await addJob({ status: "printing", attempts: 3, claimedAt: ago(40_000) });
    const r = await requeueStuckJobs(db(), NOW);
    expect(r.map((j) => [j.id, j.status])).toEqual([[j1.id, "pending"], [j2.id, "pending"], [j3.id, "failed"]]);
    expect(await job(j1.id)).toMatchObject({ status: "pending", attempts: 1 });
    expect(await job(j2.id)).toMatchObject({ status: "pending", attempts: 2 });
    expect(await job(j3.id)).toMatchObject({ status: "failed", attempts: 3, error: "sin confirmación de la impresora" });
  });

  it("ignores pending/done/failed jobs and returns [] when nothing is stuck", async () => {
    await addJob({ status: "pending", claimedAt: ago(99_000) });
    await addJob({ status: "done", claimedAt: ago(99_000) });
    expect(await requeueStuckJobs(db(), NOW)).toEqual([]);
  });

  it("two concurrent requeuers affect each job once", async () => {
    await addJob({ status: "printing", attempts: 1, claimedAt: ago(40_000) });
    await addJob({ status: "printing", attempts: 3, claimedAt: ago(40_000) });
    const [x, y] = await Promise.all([requeueStuckJobs(db(), NOW), requeueStuckJobs(db(), NOW)]);
    expect(x.length + y.length).toBe(2);
  });
});

describe("markJobFailed", () => {
  it("fails a printing job with the given error, once", async () => {
    const a = await addJob({ status: "printing", attempts: 1, claimedAt: NOW });
    expect(await markJobFailed(db(), a.id, "payload inválido", NOW)).toBe(true);
    expect(await job(a.id)).toMatchObject({ status: "failed", error: "payload inválido" });
    expect(await markJobFailed(db(), a.id, "otra vez", NOW)).toBe(false);
  });
});

describe("orders_changed notifications", () => {
  async function listen() {
    const client = new Client({ connectionString: getEnv().DATABASE_URL });
    await client.connect();
    const received: { orderId: number; status: string; event: string }[] = [];
    client.on("notification", (m) => received.push(JSON.parse(m.payload ?? "null")));
    await client.query("LISTEN orders_changed");
    return { client, received };
  }
  const barrier = (c: Client) => c.query("select 1");
  async function waitFor(pred: () => boolean, ms = 3000) {
    const end = Date.now() + ms;
    while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  }

  it("done and a final failed notify with the order's CURRENT status; a retry (back to pending) does not", async () => {
    const { client, received } = await listen();
    try {
      await db().update(s.orders).set({ status: "en_preparacion" }).where(eq(s.orders.id, orderId));
      const a = await addJob({ status: "printing", attempts: 1, claimedAt: NOW });
      const b = await addJob({ status: "printing", attempts: 3, claimedAt: NOW });
      const c = await addJob({ status: "printing", attempts: 1, claimedAt: NOW });
      await ackPrintJob(db(), { jobId: c.id, stationId: fx.stationId, status: "failed", error: "x", now: NOW });
      await barrier(client);
      expect(received).toEqual([]);
      await ackPrintJob(db(), { jobId: a.id, stationId: fx.stationId, status: "done", error: null, now: NOW });
      await waitFor(() => received.length >= 1);
      await ackPrintJob(db(), { jobId: b.id, stationId: fx.stationId, status: "failed", error: "x", now: NOW });
      await waitFor(() => received.length >= 2);
      expect(received).toEqual([
        { orderId, status: "en_preparacion", event: "updated" },
        { orderId, status: "en_preparacion", event: "updated" },
      ]);
      // idempotent second done: nothing
      await ackPrintJob(db(), { jobId: a.id, stationId: fx.stationId, status: "done", error: null, now: NOW });
      await barrier(client);
      expect(received).toHaveLength(2);
    } finally {
      await client.end();
    }
  });

  it("requeueStuckJobs notifies once per order whose job became failed, none for plain requeues", async () => {
    const { client, received } = await listen();
    try {
      await addJob({ status: "printing", attempts: 1, claimedAt: ago(40_000) });
      await requeueStuckJobs(db(), NOW);
      await barrier(client);
      expect(received).toEqual([]);
      await addJob({ status: "printing", attempts: 3, claimedAt: ago(40_000) });
      await addJob({ status: "printing", attempts: 3, claimedAt: ago(40_000), type: "ticket" });
      await requeueStuckJobs(db(), NOW);
      await waitFor(() => received.length >= 1);
      await barrier(client);
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ orderId, event: "updated" });
    } finally {
      await client.end();
    }
  });

  it("markJobFailed notifies", async () => {
    const { client, received } = await listen();
    try {
      const a = await addJob({ status: "printing", attempts: 1, claimedAt: NOW });
      await markJobFailed(db(), a.id, "payload inválido", NOW);
      await waitFor(() => received.length >= 1);
      expect(received).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it("a COMMIT that fails after the notify rolls back the ack and emits nothing", async () => {
    const { client, received } = await listen();
    try {
      const a = await addJob({ status: "printing", attempts: 1, claimedAt: NOW });
      const b = await addJob({ status: "printing", attempts: 3, claimedAt: ago(40_000) });
      await db().execute(
        sql.raw(`
          CREATE FUNCTION boom_commit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom at commit'; END $$ LANGUAGE plpgsql;
          CREATE CONSTRAINT TRIGGER boom_commit_trg AFTER UPDATE ON print_jobs
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION boom_commit();`),
      );
      await expect(ackPrintJob(db(), { jobId: a.id, stationId: fx.stationId, status: "done", error: null, now: NOW })).rejects.toThrow();
      await expect(requeueStuckJobs(db(), NOW)).rejects.toThrow();
      await barrier(client);
      await new Promise((r) => setTimeout(r, 300));
      expect(received).toEqual([]);
      expect((await job(a.id)).status).toBe("printing");
      expect((await job(b.id)).status).toBe("printing");

      await dropTriggers();
      await ackPrintJob(db(), { jobId: a.id, stationId: fx.stationId, status: "done", error: null, now: NOW });
      await waitFor(() => received.length >= 1);
      expect(received).toHaveLength(1);
    } finally {
      await client.end();
    }
  });
});
