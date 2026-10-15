/**
 * stationId -> the ONE live agent stream of that station. A new connection replaces the previous one
 * (its closer is told "replaced"), so a stale or duplicated agent can never double-print.
 * On globalThis for the same reason as the event bus: route modules and tests must share it.
 */

export type StreamCloser = (reason: "replaced") => void;
type Entry = { close: StreamCloser };

const g = globalThis as unknown as { __bhAgentStreams?: Map<number, Entry> };
const streams = (): Map<number, Entry> => (g.__bhAgentStreams ??= new Map());

export function registerAgentStream(stationId: number, close: StreamCloser): { release: () => void } {
  const map = streams();
  const previous = map.get(stationId);
  const entry: Entry = { close };
  map.set(stationId, entry);
  if (previous) {
    try {
      previous.close("replaced");
    } catch {
      // a broken old stream must not stop the new one from taking over
    }
  }
  return {
    // Identity check: a replaced stream finishing later must not evict its replacement.
    release: () => {
      if (streams().get(stationId) === entry) streams().delete(stationId);
    },
  };
}

export const hasAgentStream = (stationId: number): boolean => streams().has(stationId);
export const agentStreamCount = (): number => streams().size;

/** Test helper. */
export function resetAgentRegistry(): void {
  g.__bhAgentStreams = undefined;
}
