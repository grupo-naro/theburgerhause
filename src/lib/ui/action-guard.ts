/**
 * Synchronous in-flight guard behind `useGuardedAction`: a second click in the same frame (before
 * React re-renders the disabled state) is dropped. `finish(true)` keeps it closed after a success
 * (the card is about to leave) until `release()`.
 */
export function createActionGuard() {
  let inFlight = false;
  return {
    tryStart(): boolean {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    finish(keepLocked: boolean): void {
      if (!keepLocked) inFlight = false;
    },
    release(): void {
      inFlight = false;
    },
  };
}
