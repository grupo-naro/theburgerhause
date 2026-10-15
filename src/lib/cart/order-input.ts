import { normalizeModifierIds, normalizeNote } from "./normalize";
import type { CartLine, OrderUnitInput } from "./types";

/** Cart -> `createOrder` input: one entry per unit, no ids, no prices (the server re-prices). */
export function toOrderUnits(lines: readonly CartLine[]): OrderUnitInput[] {
  return lines.map((l) => ({
    productId: l.productId,
    modifierIds: normalizeModifierIds(l.modifierIds),
    note: normalizeNote(l.note),
  }));
}
