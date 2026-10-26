/**
 * Self-healing of the counter TV (pure). The TV is left on for days with nobody to press "Reintentar": when the page
 * breaks (the app restarting on a deploy, a DB hiccup) it must come back by itself.
 */

/** First in-place retry of the error screen. */
export const RECOVERY_FIRST_MS = 5_000;
/** Then one attempt every 15 s. */
export const RECOVERY_INTERVAL_MS = 15_000;
/** In-place retries before falling back to reloading the whole page. */
export const RELOAD_AFTER_RETRIES = 3;

export type RecoveryStep = { action: "retry" | "reload"; delayMs: number };

/** What the error screen does on its `attempt`-th try (1-based), and how long it waits before it. */
export function recoveryStep(attempt: number): RecoveryStep {
  const n = Number.isFinite(attempt) && attempt >= 1 ? Math.floor(attempt) : 1;
  if (n === 1) return { action: "retry", delayMs: RECOVERY_FIRST_MS };
  if (n <= RELOAD_AFTER_RETRIES) return { action: "retry", delayMs: RECOVERY_INTERVAL_MS };
  return { action: "reload", delayMs: RECOVERY_INTERVAL_MS };
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Refreshes only when /api/health answers 2xx. A refresh that gets a non-ok answer (nginx 502 while the app restarts,
 * a 500) makes Next navigate the whole page to that error; skipping it keeps the board on screen until the server is
 * back. Never throws.
 */
export async function refreshIfHealthy(fetcher: Fetcher, refresh: () => void): Promise<boolean> {
  try {
    const res = await fetcher("/api/health", { cache: "no-store" });
    if (!res.ok) return false;
  } catch {
    return false;
  }
  refresh();
  return true;
}
