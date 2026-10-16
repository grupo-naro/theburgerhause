import { orderTotals } from "@/domain/pricing";
import { unitInputFor, type MenuIndex } from "@/lib/cart/pricing";
import type { CartLine, UnitConfig } from "@/lib/cart/types";

/** What tapping a product tile adds: ONE plain unit (no modifiers, no note). */
export const PLAIN_UNIT: UnitConfig = { modifierIds: [], note: "" };

/** Ticket subtotal / total via the DOMAIN `orderTotals` (no delivery fee at the counter). */
export function ticketTotals(lines: readonly CartLine[], index: MenuIndex): { subtotal: number; total: number } {
  const units = lines.flatMap((l) => {
    const u = unitInputFor(l, index);
    return u ? [u] : [];
  });
  if (units.length === 0) return { subtotal: 0, total: 0 };
  return orderTotals(units, 0);
}
