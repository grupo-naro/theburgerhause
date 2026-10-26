/**
 * Polling policy of the estimate notice: one request per interval while the tab is visible, an
 * immediate refresh when it becomes visible or the network returns. After `stop()` nothing runs:
 * no timer is left and no further request starts, even if a fetch was in flight.
 */
export function createLivePoller(deps: {
  intervalMs: number;
  isVisible: () => boolean;
  refresh: () => Promise<void>;
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
}) {
  let stopped = false;
  let timer: unknown;

  const clear = () => {
    if (timer !== undefined) deps.cancel(timer);
    timer = undefined;
  };
  const loop = () => {
    clear();
    if (stopped || !deps.isVisible()) return;
    timer = deps.schedule(async () => {
      timer = undefined;
      if (stopped) return;
      await deps.refresh();
      loop();
    }, deps.intervalMs);
  };
  /** visibilitychange / online */
  const wake = () => {
    if (stopped) return;
    if (!deps.isVisible()) return clear();
    void deps.refresh();
    loop();
  };

  return {
    start: loop,
    wake,
    stop() {
      stopped = true;
      clear();
    },
  };
}
