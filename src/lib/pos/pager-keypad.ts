import { PAGER_MAX, PAGER_MIN } from "@/lib/orders/counter-schemas";

export type PagerKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "back" | "clear";

const MAX_DIGITS = String(PAGER_MAX).length;

/**
 * State machine of the on-screen pager keypad. The state is the typed digit string: at most 3
 * digits (so never above 999), no leading zero, backspace / clear. Unknown keys change nothing.
 */
export function pagerKey(state: string, key: PagerKey): string {
  if (key === "clear") return "";
  if (key === "back") return state.slice(0, -1);
  if (!/^[0-9]$/.test(key)) return state;
  if (state.length >= MAX_DIGITS) return state;
  if (state === "" && key === "0") return state;
  return state + key;
}

/** The pager the typed digits stand for, or null when empty / out of 1..999. */
export function pagerValue(state: string): number | null {
  if (!/^[0-9]+$/.test(state)) return null;
  const n = Number(state);
  return n >= PAGER_MIN && n <= PAGER_MAX ? n : null;
}
