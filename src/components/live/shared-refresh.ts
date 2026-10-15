import { createDebounce, type Debounce } from "@/lib/events/debounce";

export const REFRESH_DEBOUNCE_MS = 250;

type Refreshable = { refresh: () => void };

let latest: Refreshable | null = null;
let shared: Debounce | null = null;

/**
 * ONE trailing debounce for every `router.refresh()` request on the page (live events, resyncs,
 * the periodic heartbeat): requests within the window coalesce into a single refresh.
 */
export function requestRefresh(router: Refreshable): void {
  latest = router;
  shared ??= createDebounce(() => latest?.refresh(), REFRESH_DEBOUNCE_MS, {
    schedule: (fn, ms) => window.setTimeout(fn, ms),
    cancel: (handle) => window.clearTimeout(handle as number),
  });
  shared.call();
}

export function cancelRefresh(): void {
  shared?.cancel();
}
