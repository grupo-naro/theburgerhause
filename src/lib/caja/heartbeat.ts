export const HEARTBEAT_MS = 30_000;

type Deps = {
  intervalMs: number;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
  isVisible: () => boolean;
  onTick: () => void;
};

/**
 * Periodic "refresh the server data" tick for facts that emit no event (the print agent's
 * heartbeat). Runs only while the page is visible; becoming visible ticks immediately.
 * Pure: scheduler and visibility are injected.
 */
export function createHeartbeat(deps: Deps) {
  let timer: unknown = null;
  let running = false;

  const disarm = () => {
    if (timer !== null) deps.cancel(timer);
    timer = null;
  };
  const arm = () => {
    disarm();
    timer = deps.schedule(() => {
      timer = null;
      if (!running) return;
      if (deps.isVisible()) deps.onTick();
      if (running && deps.isVisible()) arm();
    }, deps.intervalMs);
  };

  return {
    start() {
      running = true;
      if (deps.isVisible()) arm();
    },
    visibilityChanged() {
      if (!running) return;
      if (deps.isVisible()) {
        deps.onTick();
        arm();
      } else {
        disarm();
      }
    },
    stop() {
      running = false;
      disarm();
    },
  };
}
