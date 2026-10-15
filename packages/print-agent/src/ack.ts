import { backoffDelay, type Clock, type Rng, type TimerHandle } from "./clock";
import type { Logger } from "./logger";
import type { StateStore } from "./state";

const USER_AGENT = "BurgerHouseAgent/0.1";
const MAX_RETRY_AFTER_MS = 10 * 60_000;

export type AckOutcome =
  | { kind: "delivered" }
  | { kind: "rejected"; httpStatus: number } // 400/404/409: retrying can never help
  | { kind: "retry"; reason: string; retryAfterMs?: number };

export type HeartbeatOutcome = { ok: true; serverTime: string } | { ok: false; reason: "unauthorized" | "ratelimited" | "network" | "server" };

/** Seconds ("7") or an HTTP date, as milliseconds; undefined when absent/garbled. */
export function parseRetryAfter(header: string | null, nowMs = Date.now()): number | undefined {
  if (!header) return undefined;
  const secs = /^\d{1,7}$/.test(header.trim()) ? Number(header) * 1000 : Date.parse(header) - nowMs;
  if (!Number.isFinite(secs)) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(1000, secs));
}

export type ApiOptions = { serverUrl: string; token: string; fetch?: typeof fetch; timeoutMs?: number };

/** The two plain-HTTP endpoints of the protocol (the stream lives in client.ts). */
export class AgentApi {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  constructor(private readonly opts: ApiOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  private headers(json: boolean): Record<string, string> {
    return { authorization: `Bearer ${this.opts.token}`, "user-agent": USER_AGENT, ...(json ? { "content-type": "application/json" } : {}) };
  }

  async postAck(jobId: number, status: "done" | "failed", error?: string): Promise<AckOutcome> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.serverUrl}/api/agent/jobs/${jobId}/ack`, {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify({ status, ...(error ? { error } : {}) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return { kind: "retry", reason: "network" };
    }
    await res.body?.cancel().catch(() => undefined);
    if (res.ok) return { kind: "delivered" };
    if (res.status === 400 || res.status === 404 || res.status === 409) return { kind: "rejected", httpStatus: res.status };
    return { kind: "retry", reason: String(res.status), retryAfterMs: res.status === 429 ? parseRetryAfter(res.headers.get("retry-after")) : undefined };
  }

  async heartbeat(): Promise<HeartbeatOutcome> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.opts.serverUrl}/api/agent/heartbeat`, { method: "POST", headers: this.headers(false), signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      return { ok: false, reason: "network" };
    }
    if (res.status === 401) return { ok: false, reason: "unauthorized" };
    if (res.status === 429) return { ok: false, reason: "ratelimited" };
    if (!res.ok) return { ok: false, reason: "server" };
    try {
      const body = (await res.json()) as { serverTime?: unknown };
      return { ok: true, serverTime: typeof body.serverTime === "string" ? body.serverTime : "" };
    } catch {
      return { ok: false, reason: "server" };
    }
  }
}

export interface AckSink {
  submit(ack: { jobId: number; status: "done" | "failed"; error?: string }): void;
}

/**
 * Reliable ack delivery: every ack is first persisted in the state file, then sent; failures are
 * retried (1 s -> 30 s backoff, Retry-After honored) until the server has it. A `done` ack is never
 * lost across restarts: start() sends whatever was left in the queue.
 */
export class AckDelivery implements AckSink {
  private flushing: Promise<void> | null = null;
  private again = false;
  private timer: TimerHandle | null = null;
  private streak = 0;
  private stopped = false;

  constructor(private readonly opts: { api: AgentApi; state: StateStore; clock: Clock; rng: Rng; logger: Logger }) {}

  start(): void {
    void this.flush();
  }

  submit(ack: { jobId: number; status: "done" | "failed"; error?: string }): void {
    this.opts.state.enqueueAck(ack);
    void this.flush();
  }

  /** Resolves when no delivery attempt is running. */
  async idle(): Promise<void> {
    while (this.flushing) await this.flushing;
  }

  /** One pass over the queue now (also used right after a (re)connection). */
  flush(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    this.flushing = this.run().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.timer?.cancel();
    this.timer = null;
    await this.idle();
  }

  private async run(): Promise<void> {
    const { api, state, logger } = this.opts;
    let retryAfter: number | undefined;
    let failed = false;
    do {
      this.again = false;
      for (const ack of state.pendingAcks()) {
        if (this.stopped) return;
        state.recordAckAttempt(ack.jobId);
        const r = await api.postAck(ack.jobId, ack.status, ack.error);
        if (r.kind === "delivered") {
          state.removeAck(ack.jobId);
          this.streak = 0;
        } else if (r.kind === "rejected") {
          state.removeAck(ack.jobId);
          logger.warn("ack descartado: el servidor lo rechazó", { job: ack.jobId, http: r.httpStatus });
        } else {
          failed = true;
          retryAfter = r.retryAfterMs;
          logger.warn("no se pudo confirmar el trabajo; se reintenta", { job: ack.jobId, motivo: r.reason });
          break;
        }
      }
    } while (this.again && !failed && !this.stopped);
    if (failed && !this.stopped && !this.timer) this.schedule(retryAfter);
  }

  private schedule(retryAfter: number | undefined): void {
    const delay = retryAfter ?? backoffDelay(this.streak, this.opts.rng);
    this.streak++;
    this.timer = this.opts.clock.setTimeout(
      () => {
        this.timer = null;
        void this.flush();
      },
      delay,
      "ack-retry",
    );
  }
}
