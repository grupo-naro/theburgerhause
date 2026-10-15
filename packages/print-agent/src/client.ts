import { parseRetryAfter } from "./ack";
import { backoffDelay, sleep, type Clock, type Rng, type TimerHandle } from "./clock";
import type { Logger } from "./logger";
import { parseAgentEvent, SseParser, type AgentJob, type Hello } from "./protocol";

export const TOKEN_ERROR_MESSAGE = "Token inválido o rotado: generá uno nuevo en Admin → Estaciones";
export const REPLACED_WAIT_MS = 60_000;
export const STABLE_AFTER_MS = 30_000;
export const SILENCE_LIMIT_MS = 75_000; // the server pings every 25 s
const AUTH_BACKOFF_FIRST_MS = 5_000;
const AUTH_BACKOFF_MAX_MS = 5 * 60_000;
const RATE_LIMIT_DEFAULT_MS = 30_000;

export type StreamClientOptions = {
  serverUrl: string;
  token: string;
  clock: Clock;
  rng: Rng;
  logger: Logger;
  fetch?: typeof fetch;
  onJob: (job: AgentJob) => void;
  onHello?: (hello: Hello) => void;
};

type Outcome =
  | { kind: "ended"; upMs: number }
  | { kind: "silent"; upMs: number }
  | { kind: "replaced" }
  | { kind: "unauthorized" }
  | { kind: "ratelimited"; waitMs: number }
  | { kind: "error"; reason: string };

/**
 * Keeps one SSE connection to /api/agent/stream alive and hands the jobs over. Reconnect policy
 * (docs/ops/print-agent-protocol.md): exponential 1 s -> 30 s + jitter, reset once a connection
 * stayed up 30 s; `replaced` -> wait 60 s; 401 -> 5 s doubling up to 5 min; 429 -> Retry-After.
 */
export class StreamClient {
  private readonly abort = new AbortController();
  private current: AbortController | null = null;
  private loop: Promise<void> | null = null;
  private _connected = false;

  constructor(private readonly opts: StreamClientOptions) {}

  get connected(): boolean {
    return this._connected;
  }

  start(): void {
    this.loop ??= this.run();
  }

  async stop(): Promise<void> {
    this.abort.abort();
    this.current?.abort();
    await this.loop;
  }

  private async run(): Promise<void> {
    const { logger, clock, rng } = this.opts;
    let failures = 0;
    let authFailures = 0;
    while (!this.abort.signal.aborted) {
      const outcome = await this.connectOnce();
      if (this.abort.signal.aborted) return;
      let wait: number;
      switch (outcome.kind) {
        case "unauthorized":
          wait = Math.min(AUTH_BACKOFF_MAX_MS, AUTH_BACKOFF_FIRST_MS * 2 ** Math.min(authFailures, 20));
          authFailures++;
          logger.error(TOKEN_ERROR_MESSAGE, { reintento_en_s: Math.round(wait / 1000) });
          break;
        case "ratelimited":
          wait = outcome.waitMs;
          logger.warn("El servidor pidió esperar antes de reconectar", { reintento_en_s: Math.round(wait / 1000) });
          break;
        case "replaced":
          wait = REPLACED_WAIT_MS;
          failures = 0;
          logger.error("Otro agente se conectó para esta estación: este agente se pausa. Revisá que no haya otra PC o proceso usando el mismo token", { reintento_en_s: wait / 1000 });
          break;
        case "ended":
        case "silent":
          if (outcome.upMs >= STABLE_AFTER_MS) failures = 0;
          wait = backoffDelay(failures++, rng);
          logger.warn(outcome.kind === "silent" ? "Conexión sin señal del servidor; se reconecta" : "Conexión cerrada por el servidor; se reconecta", { reintento_en_ms: wait });
          break;
        case "error":
          wait = backoffDelay(failures++, rng);
          logger.warn("No se pudo conectar con el servidor", { motivo: outcome.reason, reintento_en_ms: wait });
          break;
      }
      await sleep(clock, wait, "reconnect", this.abort.signal);
    }
  }

  private async connectOnce(): Promise<Outcome> {
    const { serverUrl, token, clock, logger } = this.opts;
    const fetchImpl = this.opts.fetch ?? fetch;
    const ac = new AbortController();
    this.current = ac;
    if (this.abort.signal.aborted) ac.abort();
    let res: Response;
    try {
      res = await fetchImpl(`${serverUrl}/api/agent/stream`, {
        headers: { authorization: `Bearer ${token}`, accept: "text/event-stream", "user-agent": "BurgerHouseAgent/0.1" },
        signal: ac.signal,
      });
    } catch {
      return { kind: "error", reason: "red" };
    }
    if (res.status === 401) {
      await res.body?.cancel().catch(() => undefined);
      return { kind: "unauthorized" };
    }
    if (res.status === 429) {
      const waitMs = parseRetryAfter(res.headers.get("retry-after")) ?? RATE_LIMIT_DEFAULT_MS;
      await res.body?.cancel().catch(() => undefined);
      return { kind: "ratelimited", waitMs };
    }
    if (res.status !== 200 || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      return { kind: "error", reason: `HTTP ${res.status}` };
    }

    const connectedAt = clock.now();
    const parser = new SseParser();
    let replaced = false;
    let silent = false;
    const watchdog: { h: TimerHandle | null } = { h: null };
    const arm = () => {
      watchdog.h?.cancel();
      watchdog.h = clock.setTimeout(
        () => {
          silent = true;
          logger.warn("Sin señal del servidor (ni siquiera ping)");
          ac.abort();
        },
        SILENCE_LIMIT_MS,
        "idle",
      );
    };
    arm();
    this._connected = true;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        for (const frame of parser.push(value)) {
          const ev = parseAgentEvent(frame);
          if (ev.kind === "hello") {
            logger.info("Agente conectado", { estacion: ev.hello.stationName });
            this.opts.onHello?.(ev.hello);
          } else if (ev.kind === "job") {
            this.opts.onJob(ev.job);
          } else if (ev.kind === "replaced") {
            replaced = true;
            ac.abort(); // do not wait for the server to close it
          } else {
            logger.debug("Evento ignorado", { motivo: ev.reason });
          }
        }
        if (replaced) break;
      }
    } catch {
      // aborted (stop, silence, replaced) or the connection dropped
    } finally {
      watchdog.h?.cancel();
      this._connected = false;
      await reader.cancel().catch(() => undefined);
    }
    const upMs = clock.now() - connectedAt;
    if (replaced) return { kind: "replaced" };
    if (silent) return { kind: "silent", upMs };
    return { kind: "ended", upMs };
  }
}
