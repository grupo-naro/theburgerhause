import type { Channel, ChannelPayloads } from "./channels";

/**
 * In-process fan-out between the single pg listener and the open SSE streams. The state lives
 * on globalThis because Next may bundle instrumentation and route handlers as separate module
 * instances: a module-level Map would give the listener and the routes different buses.
 */

export type BusTopic = Channel | "resync";
export type BusPayload<T extends BusTopic> = T extends Channel ? ChannelPayloads[T] : undefined;
type Handler = (payload: never) => void;

const g = globalThis as unknown as { __bhEventBus?: Map<BusTopic, Set<{ fn: Handler }>> };

function store(): Map<BusTopic, Set<{ fn: Handler }>> {
  return (g.__bhEventBus ??= new Map());
}

/** Returns an idempotent unsubscribe function. */
export function subscribe<T extends BusTopic>(topic: T, handler: (payload: BusPayload<T>) => void): () => void {
  const entry = { fn: handler as unknown as Handler };
  const bucket = store().get(topic) ?? new Set();
  bucket.add(entry);
  store().set(topic, bucket);
  return () => {
    const b = store().get(topic);
    b?.delete(entry);
    if (b && b.size === 0) store().delete(topic);
  };
}

export function publish<T extends BusTopic>(topic: T, ...payload: T extends "resync" ? [] : [BusPayload<T>]): void {
  const bucket = store().get(topic);
  if (!bucket) return;
  for (const { fn } of [...bucket]) {
    try {
      (fn as (p?: unknown) => void)(payload[0]);
    } catch {
      // One bad subscriber must not break the others; never log what it threw (may hold payload data).
      console.error("[events] bus handler failed");
    }
  }
}

export function listenerCount(): number {
  let n = 0;
  for (const b of store().values()) n += b.size;
  return n;
}

/** Test helper: drops every subscription. */
export function resetBus(): void {
  g.__bhEventBus = undefined;
}
