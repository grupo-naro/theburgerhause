import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db, DbTransaction } from "@/db/client";
import * as s from "@/db/schema";
import type { OrderStatus } from "@/domain/order-status";
import { ORDERS_CHANNEL } from "@/lib/events/channels";
import { notifyInTx } from "@/lib/events/notify";
import { MAX_ATTEMPTS, STUCK_AFTER_MS } from "./protocol";

/**
 * Print job state machine used by the agent endpoints (docs/ops/print-agent-protocol.md). No next/*.
 * Every state change that the Caja shows (job became done / finally failed) emits orders_changed
 * INSIDE the same transaction, so it is delivered only if the change commits. Nothing here logs.
 */

export type PrintJobType = (typeof s.printJobs.$inferSelect)["type"];
export type ClaimedJob = { id: number; orderId: number; type: PrintJobType; payload: unknown; attempts: number; createdAt: Date };
export type RequeuedJob = { id: number; orderId: number; stationId: number; status: "pending" | "failed"; attempts: number };
export type AckResult = { kind: "ok"; status: "pending" | "done" | "failed" } | { kind: "not_found" } | { kind: "not_printing" };

export const NO_CONFIRMATION_ERROR = "sin confirmación de la impresora";
export const INVALID_PAYLOAD_ERROR = "payload inválido";
const GENERIC_PRINT_ERROR = "error de impresión";
const MAX_PG_INT = 2_147_483_647;

const isPgId = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= MAX_PG_INT;

type Row = Record<string, unknown>;

/** Tells the Caja (live) that the order's print state changed; carries the order's CURRENT status. */
async function notifyOrdersUpdated(tx: DbTransaction, orderIds: number[]): Promise<void> {
  if (orderIds.length === 0) return;
  const rows = await tx.select({ id: s.orders.id, status: s.orders.status }).from(s.orders).where(inArray(s.orders.id, orderIds));
  for (const o of rows.sort((a, b) => a.id - b.id)) {
    await notifyInTx(tx, ORDERS_CHANNEL, { orderId: o.id, status: o.status as OrderStatus, event: "updated" });
  }
}

/**
 * Claims up to `limit` pending jobs of the station, oldest first, in ONE statement:
 * `FOR UPDATE SKIP LOCKED` inside the (materialized) subselect means two concurrent claimers can
 * never receive the same row. RETURNING has no order guarantee, hence the sort.
 */
export async function claimPendingJobs(db: Db | DbTransaction, stationId: number, now: Date, limit: number): Promise<ClaimedJob[]> {
  const n = Math.floor(limit);
  if (!Number.isFinite(n) || n <= 0) return [];
  const at = now.toISOString();
  const res = await db.execute(sql`
    WITH picked AS MATERIALIZED (
      SELECT id FROM print_jobs
      WHERE station_id = ${stationId} AND status = 'pending'
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT ${n}
    )
    UPDATE print_jobs
    SET status = 'printing', claimed_at = ${at}::timestamptz, attempts = attempts + 1, updated_at = ${at}::timestamptz
    WHERE id IN (SELECT id FROM picked)
    RETURNING id, order_id, type, payload, attempts, (extract(epoch from created_at) * 1000)::float8 AS created_ms`);
  return (res.rows as Row[])
    .map((r) => ({
      id: r.id as number,
      orderId: r.order_id as number,
      type: r.type as PrintJobType,
      payload: r.payload,
      attempts: r.attempts as number,
      // drizzle's raw execute() hands timestamps back as strings; epoch millis are unambiguous.
      createdAt: new Date(Math.round(r.created_ms as number)),
    }))
    .sort((a, b) => a.id - b.id);
}

/**
 * Gives back jobs this caller claimed but could not deliver (the stream closed meanwhile): only rows
 * still `printing` AND claimed at exactly `claimedAt` are touched, and the attempt is refunded.
 */
export async function unclaimJobs(db: Db, ids: number[], claimedAt: Date): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(s.printJobs)
    .set({ status: "pending", claimedAt: null, attempts: sql`greatest(${s.printJobs.attempts} - 1, 0)` })
    .where(and(inArray(s.printJobs.id, ids), eq(s.printJobs.status, "printing"), eq(s.printJobs.claimedAt, claimedAt)))
    .returning({ id: s.printJobs.id });
  return rows.length;
}

/**
 * `printing` jobs claimed more than `stuckAfterMs` ago: back to pending, or failed for good once
 * they used all attempts. One UPDATE ... RETURNING (concurrent callers touch each row once).
 */
export async function requeueStuckJobs(
  db: Db,
  now: Date,
  opts: { stuckAfterMs?: number; maxAttempts?: number } = {},
): Promise<RequeuedJob[]> {
  const stuckAfterMs = opts.stuckAfterMs ?? STUCK_AFTER_MS;
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const at = now.toISOString();
  return db.transaction(async (tx) => {
    const res = await tx.execute(sql`
      WITH upd AS (
        UPDATE print_jobs
        SET status = CASE WHEN attempts >= ${maxAttempts} THEN 'failed'::print_job_status ELSE 'pending'::print_job_status END,
            error = CASE WHEN attempts >= ${maxAttempts} THEN ${NO_CONFIRMATION_ERROR}::text ELSE error END,
            updated_at = ${at}::timestamptz
        WHERE status = 'printing' AND claimed_at < ${at}::timestamptz - (${stuckAfterMs}::double precision * interval '1 millisecond')
        RETURNING id, order_id, station_id, status, attempts
      )
      SELECT id, order_id, station_id, status, attempts FROM upd ORDER BY id`);
    const jobs = (res.rows as Row[]).map((r) => ({
      id: r.id as number,
      orderId: r.order_id as number,
      stationId: r.station_id as number,
      status: r.status as "pending" | "failed",
      attempts: r.attempts as number,
    }));
    await notifyOrdersUpdated(tx, [...new Set(jobs.filter((j) => j.status === "failed").map((j) => j.orderId))]);
    return jobs;
  });
}

/**
 * Applies an agent ack. `done` is accepted from ANY non-done state (the paper exists, even after a
 * timeout requeue or a final failure) and is idempotent; `failed` only counts while the job is
 * `printing`. Jobs of other stations are reported exactly like unknown ids.
 */
export async function ackPrintJob(
  db: Db,
  args: { jobId: number; stationId: number; status: "done" | "failed"; error: string | null; now: Date },
): Promise<AckResult> {
  const { jobId, stationId, status, error, now } = args;
  if (!isPgId(jobId)) return { kind: "not_found" };
  return db.transaction(async (tx): Promise<AckResult> => {
    const [job] = await tx
      .select({ status: s.printJobs.status, attempts: s.printJobs.attempts, orderId: s.printJobs.orderId })
      .from(s.printJobs)
      .where(and(eq(s.printJobs.id, jobId), eq(s.printJobs.stationId, stationId)))
      .for("update");
    if (!job) return { kind: "not_found" };

    if (status === "done") {
      if (job.status === "done") return { kind: "ok", status: "done" };
      await tx.update(s.printJobs).set({ status: "done", printedAt: now, error: null, updatedAt: now }).where(eq(s.printJobs.id, jobId));
      await notifyOrdersUpdated(tx, [job.orderId]);
      return { kind: "ok", status: "done" };
    }

    if (job.status !== "printing") return { kind: "not_printing" };
    const message = error ?? GENERIC_PRINT_ERROR;
    if (job.attempts < MAX_ATTEMPTS) {
      await tx.update(s.printJobs).set({ status: "pending", error: message, updatedAt: now }).where(eq(s.printJobs.id, jobId));
      return { kind: "ok", status: "pending" };
    }
    await tx.update(s.printJobs).set({ status: "failed", error: message, updatedAt: now }).where(eq(s.printJobs.id, jobId));
    await notifyOrdersUpdated(tx, [job.orderId]);
    return { kind: "ok", status: "failed" };
  });
}

/** Final failure decided by the server itself (e.g. a stored document that no longer validates). */
export async function markJobFailed(db: Db, jobId: number, error: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(s.printJobs)
      .set({ status: "failed", error, updatedAt: now })
      .where(and(eq(s.printJobs.id, jobId), eq(s.printJobs.status, "printing")))
      .returning({ orderId: s.printJobs.orderId });
    if (rows.length === 0) return false;
    await notifyOrdersUpdated(tx, [rows[0].orderId]);
    return true;
  });
}
