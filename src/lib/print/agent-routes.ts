import { getDb, type Db } from "@/db/client";
import { touchStationSeen } from "./agent-auth";
import { authorizeAgent, jsonResponse } from "./agent-http";
import { ackPrintJob } from "./jobs";
import { ackBodySchema } from "./protocol";

/** Handlers of POST /api/agent/jobs/[id]/ack and POST /api/agent/heartbeat (route files only re-export them). */

type Options = { db?: Db; now?: () => Date };
const MAX_BODY_CHARS = 4_096;
const JOB_ID = /^[1-9][0-9]{0,9}$/;

async function touch(db: Db, stationId: number, now: Date): Promise<void> {
  try {
    await touchStationSeen(db, stationId, now);
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    console.error(`[print] could not refresh last_seen_at${typeof code === "string" ? ` (${code})` : ""}`);
  }
}

export function createAckHandler(opts: Options = {}) {
  const now = opts.now ?? (() => new Date());
  return async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
    const db = opts.db ?? getDb();
    const auth = await authorizeAgent(request, db);
    if (!auth.ok) return auth.response;
    const { station } = auth;

    let raw: unknown;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY_CHARS) throw new Error("too large");
      raw = JSON.parse(text);
    } catch {
      return jsonResponse(400, { error: "invalid_body" });
    }
    const body = ackBodySchema.safeParse(raw);
    if (!body.success) return jsonResponse(400, { error: "invalid_body" });

    const { id } = await ctx.params;
    const at = now();
    await touch(db, station.id, at);
    // Malformed ids look exactly like unknown ones (and like other stations' jobs).
    if (!JOB_ID.test(id)) return jsonResponse(404, { error: "not_found" });

    let result;
    try {
      result = await ackPrintJob(db, { jobId: Number(id), stationId: station.id, status: body.data.status, error: body.data.error, now: at });
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      console.error(`[print] ack failed${typeof code === "string" ? ` (${code})` : ""}`);
      return jsonResponse(503, { error: "unavailable" }, { "Retry-After": "2" });
    }
    if (result.kind === "not_found") return jsonResponse(404, { error: "not_found" });
    if (result.kind === "not_printing") return jsonResponse(409, { error: "not_printing" });
    return jsonResponse(200, { ok: true, status: result.status });
  };
}

export function createHeartbeatHandler(opts: Options = {}) {
  const now = opts.now ?? (() => new Date());
  return async function POST(request: Request): Promise<Response> {
    const db = opts.db ?? getDb();
    const auth = await authorizeAgent(request, db);
    if (!auth.ok) return auth.response;
    const at = now();
    try {
      await touchStationSeen(db, auth.station.id, at);
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      console.error(`[print] heartbeat failed${typeof code === "string" ? ` (${code})` : ""}`);
      return jsonResponse(503, { error: "unavailable" }, { "Retry-After": "2" });
    }
    return jsonResponse(200, { ok: true, serverTime: at.toISOString() });
  };
}
