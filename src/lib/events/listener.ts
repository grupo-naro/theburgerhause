import { Client } from "pg";
import { getEnv } from "@/lib/env";
import { DEFAULT_BACKOFF, reconnectDelay, type Backoff } from "./backoff";
import { publish } from "./bus";
import { ORDERS_CHANNEL, PRINT_CHANNEL, parseEventPayload } from "./channels";

/**
 * ONE dedicated LISTEN connection per process (never from the pool: pooled clients are recycled
 * and LISTEN state would be lost). Cached on globalThis so HMR / duplicate starts cannot open a second.
 *
 * The failure mode this guards against: a NOTIFY sent while we were disconnected is gone for
 * good. So after EVERY successful (re)connect we publish a synthetic "resync" and clients refetch.
 * Logs use fixed strings plus the pg error code only; never connection strings or payloads.
 */

export const LISTENER_APP_NAME = "bh-listener";
export type ListenerStatus = "connecting" | "live" | "down";
export type ListenerOptions = { connectionString?: string; backoff?: Backoff };

type State = {
  status: ListenerStatus;
  client: Client | null;
  timer: ReturnType<typeof setTimeout> | null;
  attempt: number;
  stopped: boolean;
  connectionString: string;
  backoff: Backoff;
};

const g = globalThis as unknown as { __bhListener?: State };

export function listenerStatus(): ListenerStatus {
  return g.__bhListener?.status ?? "down";
}

function logFailure(what: string, err: unknown): void {
  const code = (err as { code?: unknown } | null)?.code;
  console.error(`[events] listener ${what}${typeof code === "string" ? ` (${code})` : ""}`);
}

export function startListener(opts: ListenerOptions = {}): void {
  if (g.__bhListener && !g.__bhListener.stopped) return; // idempotent
  const state: State = {
    status: "connecting",
    client: null,
    timer: null,
    attempt: 0,
    stopped: false,
    connectionString: opts.connectionString ?? getEnv().DATABASE_URL,
    backoff: opts.backoff ?? DEFAULT_BACKOFF,
  };
  g.__bhListener = state;
  void connect(state);
}

async function connect(state: State): Promise<void> {
  if (state.stopped) return;
  state.timer = null;
  const client = new Client({
    connectionString: state.connectionString,
    application_name: LISTENER_APP_NAME,
    keepAlive: true,
  });
  state.client = client;

  let lost = false;
  const onLost = (err?: unknown) => {
    if (lost) return;
    lost = true;
    if (state.client === client) state.client = null;
    // Swallow late errors of the dead client (must keep a handler attached).
    client.removeAllListeners("notification");
    client.on("error", () => {});
    client.end().catch(() => {});
    if (state.stopped) return;
    if (err !== undefined) logFailure("connection lost", err);
    state.status = "down";
    scheduleReconnect(state);
  };
  client.on("error", onLost);
  client.on("end", () => onLost());
  client.on("notification", (msg) => {
    const channel = msg.channel;
    if (channel !== ORDERS_CHANNEL && channel !== PRINT_CHANNEL) return;
    const payload = parseEventPayload(channel, msg.payload ?? "");
    if (payload === null) {
      console.error("[events] ignored malformed notification");
      return;
    }
    if (channel === ORDERS_CHANNEL) publish(ORDERS_CHANNEL, payload as never);
    else publish(PRINT_CHANNEL, payload as never);
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${ORDERS_CHANNEL}`);
    await client.query(`LISTEN ${PRINT_CHANNEL}`);
  } catch (err) {
    onLost(err);
    return;
  }
  if (state.stopped || state.client !== client) {
    // stopListener() or a loss raced the handshake.
    client.end().catch(() => {});
    return;
  }
  state.status = "live";
  state.attempt = 0;
  publish("resync");
}

function scheduleReconnect(state: State): void {
  if (state.stopped || state.timer) return;
  const delay = reconnectDelay(state.attempt++, state.backoff);
  state.timer = setTimeout(() => void connect(state), delay);
  state.timer.unref?.();
}

/** Tests / shutdown: cancels timers, closes the connection, no reconnect. Resolves once closed. */
export async function stopListener(): Promise<void> {
  const state = g.__bhListener;
  if (!state) return;
  state.stopped = true;
  state.status = "down";
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  const client = state.client;
  state.client = null;
  g.__bhListener = undefined;
  if (client) {
    client.removeAllListeners("notification");
    client.on("error", () => {});
    await client.end().catch(() => {});
  }
}
