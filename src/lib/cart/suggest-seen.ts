const KEY = "bh:suggest-seen";
let seenInMemory = false;

/** Whether the customer already went through the suggestion sheet in this tab session. */
export function hasSeenSuggestions(): boolean {
  if (seenInMemory) return true;
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false; // storage blocked: the in-memory flag still covers the SPA session
  }
}

export function markSuggestionsSeen(): void {
  seenInMemory = true;
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    // ignore
  }
}
