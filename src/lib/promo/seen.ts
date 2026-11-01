import { promoSeenKey } from "./window";

// In-memory fallback for browsers that block sessionStorage (it still covers the SPA session).
const seenInMemory = new Set<string>();

/** Whether this promotion version was already handled in this tab session. */
export function hasSeenPromo(version: string): boolean {
  if (seenInMemory.has(version)) return true;
  try {
    return window.sessionStorage.getItem(promoSeenKey(version)) === "1";
  } catch {
    return false;
  }
}

export function markPromoSeen(version: string): void {
  seenInMemory.add(version);
  try {
    window.sessionStorage.setItem(promoSeenKey(version), "1");
  } catch {
    // ignore
  }
}
