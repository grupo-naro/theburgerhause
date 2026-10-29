import { and, eq, inArray } from "drizzle-orm";
import * as s from "../../src/db/schema";
import { rotateStationToken } from "../../src/lib/stations/admin";
import { SseReader } from "../../src/test-support/sse";
import { db, findStation } from "./db";

/** A random client IP per runner process, so the agent endpoints' per-IP limits never couple separate runs. */
const rnd = () => Math.floor(Math.random() * 250) + 1;
const AGENT_IP = `10.${rnd()}.${rnd()}.${rnd()}`;

export type AgentJob = { id: number; type: "kitchen" | "ticket" | "delivery" | "customer" | "additional"; attempts: number; createdAt: string; document: { blocks: unknown[] } };

const headers = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}`, "x-forwarded-for": AGENT_IP });

/** Gives the station a brand-new token through the same core the admin page uses; returns the PLAIN token. */
export async function freshStationToken(stationName: string): Promise<string> {
  const st = await findStation(stationName);
  const r = await rotateStationToken(db(), st.id);
  if (!r.ok) throw new Error(`could not rotate the token of ${stationName}`);
  return r.data.token;
}

/** Test cleanup: nothing of this station may stay pending/printing/failed for later specs. */
export async function settleStationJobs(stationName: string): Promise<void> {
  const st = await findStation(stationName);
  await db()
    .update(s.printJobs)
    .set({ status: "done" })
    .where(and(eq(s.printJobs.stationId, st.id), inArray(s.printJobs.status, ["pending", "printing", "failed"])));
}

export async function resetStationAgentState(stationName: string): Promise<void> {
  await settleStationJobs(stationName);
  await db().update(s.stations).set({ tokenHash: null, lastSeenAt: null }).where(eq(s.stations.name, stationName));
}

export function agentFetch(baseURL: string, token: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseURL}${path}`, { ...init, headers: { ...(token ? headers(token) : { "x-forwarded-for": AGENT_IP }), ...(init.headers as Record<string, string> | undefined) } });
}

/** A Node-side stand-in for the real print agent: a streaming fetch over /api/agent/stream. */
export class FakeAgent {
  private constructor(
    private readonly baseURL: string,
    private readonly token: string,
    private readonly ac: AbortController,
    readonly reader: SseReader,
  ) {}

  static async connect(baseURL: string, token: string): Promise<FakeAgent> {
    const ac = new AbortController();
    const res = await fetch(`${baseURL}/api/agent/stream`, { headers: headers(token), signal: ac.signal });
    if (res.status !== 200) throw new Error(`agent stream refused: ${res.status}`);
    const agent = new FakeAgent(baseURL, token, ac, new SseReader(res));
    await agent.reader.event("hello");
    return agent;
  }

  async jobs(count: number, timeoutMs = 3000): Promise<AgentJob[]> {
    return (await this.reader.events("job", count, timeoutMs)) as AgentJob[];
  }

  /** The next `job` frame whose data matches. */
  async jobWhere(pred: (j: AgentJob) => boolean, timeoutMs = 3000): Promise<AgentJob> {
    return (await this.reader.until((f) => f.event === "job" && pred(f.data as AgentJob), timeoutMs, "a matching job")).data as AgentJob;
  }

  ack(jobId: number, status: "done" | "failed", error?: string): Promise<Response> {
    return fetch(`${this.baseURL}/api/agent/jobs/${jobId}/ack`, {
      method: "POST",
      headers: { ...headers(this.token), "content-type": "application/json" },
      body: JSON.stringify({ status, ...(error ? { error } : {}) }),
    });
  }

  async stop(): Promise<void> {
    this.ac.abort();
    await this.reader.cancel();
  }
}
