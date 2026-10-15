import { getDb, type Db } from "@/db/client";
import { subscribe } from "@/lib/events/bus";
import { PRINT_CHANNEL } from "@/lib/events/channels";
import { touchStationSeen } from "./agent-auth";
import { authorizeAgent, jsonResponse } from "./agent-http";
import { agentStreamCount, hasAgentStream, registerAgentStream } from "./agent-registry";
import { claimPendingJobs, INVALID_PAYLOAD_ERROR, markJobFailed, requeueStuckJobs, unclaimJobs, type ClaimedJob } from "./jobs";
import { MAX_ATTEMPTS, PROTOCOL_VERSION, printDocumentSchema, sseFrame, STUCK_AFTER_MS } from "./protocol";

/**
 * Server half of GET /api/agent/stream (the route file only re-exports it). See
 * docs/ops/print-agent-protocol.md. Per connection: hello, then every `tickMs` (and on each
 * print_job_created of this station) touch last_seen_at, requeue stuck jobs and claim + send pending
 * jobs. One stream per station; every exit path funnels through `close()`.
 */

export const RETRY_MS = 3_000;

export type AgentStreamOptions = {
  tickMs?: number;
  pingMs?: number;
  /** Max simultaneous agent streams (one per station). */
  globalCap?: number;
  /** Max jobs claimed by one claim. */
  claimLimit?: number;
  /** Chunks the client may have queued; jobs are only claimed while there is room. */
  queueSize?: number;
  db?: Db;
  now?: () => Date;
};

function logFailure(what: string, err: unknown): void {
  const code = (err as { code?: unknown } | null)?.code;
  console.error(`[print] ${what}${typeof code === "string" ? ` (${code})` : ""}`); // never the payload
}

export function createAgentStreamHandler(opts: AgentStreamOptions = {}): (request: Request) => Promise<Response> {
  const { tickMs = 10_000, pingMs = 25_000, globalCap = 50, claimLimit = 20, queueSize = 32, now = () => new Date() } = opts;

  return async function GET(request: Request): Promise<Response> {
    const db = opts.db ?? getDb();
    const auth = await authorizeAgent(request, db);
    if (!auth.ok) return auth.response;
    const station = auth.station;

    // A station replacing its own stream does not add a connection.
    if (!hasAgentStream(station.id) && agentStreamCount() >= globalCap) {
      return jsonResponse(429, { error: "too_many_streams" }, { "Retry-After": "5" });
    }

    const enc = new TextEncoder();
    let closed = false;
    let claiming = false;
    let dirty = false; // a claim was requested while one was running
    let starved = false; // a claim was skipped for lack of room; retry when the client drains
    let housekeeping = false;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cleanups: Array<() => void> = [];

    const enqueue = (frame: string) => controller.enqueue(enc.encode(frame));
    const room = () => controller.desiredSize ?? 0;

    /** Idempotent; the single place that releases subscriptions, timers and the registry entry. */
    const close = (reason?: "replaced") => {
      if (closed) return;
      closed = true;
      if (reason === "replaced") {
        try {
          enqueue(sseFrame("replaced", { reason: "another agent connected for this station" }));
        } catch {
          // already cancelled
        }
      }
      for (const fn of cleanups.splice(0)) fn();
      try {
        controller.close();
      } catch {
        // already closed / cancelled by the client
      }
    };

    /** Sends valid documents; an invalid stored payload is never sent: that job fails for good. */
    const deliver = async (jobs: ClaimedJob[], claimedAt: Date) => {
      const sent = new Set<number>();
      const invalid: ClaimedJob[] = [];
      try {
        for (const j of jobs) {
          if (!printDocumentSchema.safeParse(j.payload).success) {
            invalid.push(j);
            continue;
          }
          enqueue(sseFrame("job", { id: j.id, type: j.type, attempts: j.attempts, createdAt: j.createdAt.toISOString(), document: j.payload }));
          sent.add(j.id);
        }
      } catch {
        close(); // the stream died under us: hand back what was not sent
        await unclaimJobs(db, jobs.filter((j) => !sent.has(j.id) && !invalid.includes(j)).map((j) => j.id), claimedAt).catch(() => 0);
      }
      for (const j of invalid) {
        try {
          await markJobFailed(db, j.id, INVALID_PAYLOAD_ERROR, now());
        } catch (err) {
          logFailure("could not fail an invalid job", err);
        }
      }
    };

    /** Claim loop: one claim at a time; requests arriving meanwhile coalesce into one more pass. */
    const kick = async (): Promise<void> => {
      if (closed) return;
      if (claiming) {
        dirty = true;
        return;
      }
      claiming = true;
      try {
        do {
          dirty = false;
          if (closed) break;
          const free = Math.min(claimLimit, room());
          if (free <= 0) {
            starved = true; // do not claim what we could not send
            break;
          }
          const claimedAt = now();
          const jobs = await claimPendingJobs(db, station.id, claimedAt, free);
          if (jobs.length === 0) continue;
          if (closed) {
            await unclaimJobs(db, jobs.map((j) => j.id), claimedAt).catch(() => 0);
            break;
          }
          await deliver(jobs, claimedAt);
          // The batch was cut short by the client's room (not by the per-claim cap): keep going as it drains.
          if (free < claimLimit && jobs.length === free) dirty = true;
        } while (dirty && !closed);
      } catch (err) {
        logFailure("claim failed", err);
      } finally {
        claiming = false;
      }
    };

    const tick = async (): Promise<void> => {
      if (closed) return;
      if (!housekeeping) {
        housekeeping = true;
        try {
          await touchStationSeen(db, station.id, now());
          await requeueStuckJobs(db, now());
        } catch (err) {
          logFailure("agent housekeeping failed", err);
        } finally {
          housekeeping = false;
        }
      }
      await kick();
    };

    const stream = new ReadableStream<Uint8Array>(
      {
        start(ctrl) {
          controller = ctrl;
          enqueue(`retry: ${RETRY_MS}\n\n`);
          enqueue(
            sseFrame("hello", {
              stationId: station.id,
              stationName: station.name,
              serverTime: now().toISOString(),
              protocol: PROTOCOL_VERSION,
              maxAttempts: MAX_ATTEMPTS,
              stuckAfterMs: STUCK_AFTER_MS,
            }),
          );

          // Taking the slot tells the previous stream of this station (if any) to say "replaced" and end.
          const slot = registerAgentStream(station.id, (reason) => close(reason));
          cleanups.push(slot.release);

          cleanups.push(
            subscribe(PRINT_CHANNEL, (event) => {
              if (event.stationId === station.id) void kick();
            }),
            // After a listener reconnect NOTIFYs may have been lost: look for work.
            subscribe("resync", () => void kick()),
          );

          const ping = setInterval(() => {
            if (!closed && room() > 0) enqueue(": ping\n\n");
          }, pingMs);
          const timer = setInterval(() => void tick(), tickMs);
          cleanups.push(() => clearInterval(ping), () => clearInterval(timer));

          void tick();
        },
        pull() {
          // The client drained some of the queue: resume a claim that was skipped for lack of room.
          if (starved && !closed) {
            starved = false;
            void kick();
          }
        },
        cancel() {
          close();
        },
      },
      new CountQueuingStrategy({ highWaterMark: queueSize }),
    );

    const onAbort = () => close();
    if (request.signal.aborted) close();
    else {
      request.signal.addEventListener("abort", onAbort, { once: true });
      cleanups.push(() => request.signal.removeEventListener("abort", onAbort));
    }

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  };
}
