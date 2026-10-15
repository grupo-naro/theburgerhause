import { parseCart } from "./persistence";
import type { MenuIndex } from "./pricing";
import { reconcileCart, type ReconcileOptions } from "./reconcile";
import type { CartIssue, CartLine } from "./types";

/**
 * Hydration order: parse + validate the raw storage value, then reconcile against the current
 * menu. With no menu (its load failed) the validated cart is kept as is, so a transient error
 * never wipes a customer's cart.
 */
export function initCart(
  raw: string | null,
  index: MenuIndex | null,
  options: Pick<ReconcileOptions, "names"> = {},
): { lines: CartLine[]; prices: Record<string, number>; issues: CartIssue[] } {
  const parsed = parseCart(raw);
  if (!parsed) return { lines: [], prices: {}, issues: [] };
  // No usable menu (failed load, or every product momentarily inactive): never reconcile the cart away.
  if (!index || index.products.size === 0) return { lines: parsed.lines, prices: parsed.prices, issues: [] };
  const r = reconcileCart(parsed.lines, index, { ...options, lastSeenPrices: parsed.prices });
  return { lines: r.lines, prices: r.prices, issues: r.issues };
}
