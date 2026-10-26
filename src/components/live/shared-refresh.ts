import { createDebounce, type Debounce } from "@/lib/events/debounce";

export const REFRESH_DEBOUNCE_MS = 250;

type Refreshable = { refresh: () => void };

let latest: Refreshable | null = null;
let shared: Debounce | null = null;

const offline = (): boolean => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * ONE trailing debounce for every `router.refresh()` request on the page (live events, resyncs,
 * the periodic heartbeat): requests within the window coalesce into a single refresh.
 */
export function requestRefresh(router: Refreshable): void {
  // While the browser knows it is offline a refresh cannot succeed, and a failed RSC fetch makes Next fall back to a
  // full browser navigation, which lands on the browser's offline error page and stays there (a TV left on for days
  // would never come back). Checked when asked AND when the debounce fires; the reconnect / `online` refresh catches up.
  if (offline()) return;
  latest = router;
  shared ??= createDebounce(() => (offline() ? undefined : latest?.refresh()), REFRESH_DEBOUNCE_MS, {
    schedule: (fn, ms) => window.setTimeout(fn, ms),
    cancel: (handle) => window.clearTimeout(handle as number),
  });
  shared.call();
}

export function cancelRefresh(): void {
  shared?.cancel();
}
