import { nextFreePager, type ActivePager } from "@/lib/orders/pagers";

/** Pure helpers over the list of pagers held by active counter orders. */

export function inUseNumbers(active: readonly ActivePager[]): number[] {
  return active.map((p) => p.pagerNumber);
}

export function holderOf(active: readonly ActivePager[], pager: number | null): { orderNumber: number } | null {
  if (pager === null) return null;
  const hit = active.find((p) => p.pagerNumber === pager);
  return hit ? { orderNumber: hit.orderNumber } : null;
}

export function conflictMessage(pager: number, holder: { orderNumber: number }): string {
  return `Llamador ${pager} en uso por el pedido #${holder.orderNumber}`;
}

/** "Siguiente libre": the lowest free number (domain `nextFreePager`), null when all 999 are taken. */
export function suggestPager(active: readonly ActivePager[]): number | null {
  return nextFreePager(inUseNumbers(active));
}
