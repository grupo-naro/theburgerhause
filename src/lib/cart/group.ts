import { signature } from "./signature";
import type { CartGroup, CartLine } from "./types";

/** Groups identical configurations, ordered by first appearance; lines keep their relative order. */
export function groupLines(lines: readonly CartLine[]): CartGroup[] {
  const groups = new Map<string, CartGroup>();
  for (const line of lines) {
    const sig = signature(line);
    const existing = groups.get(sig);
    if (existing) {
      existing.quantity += 1;
      existing.lineIds.push(line.id);
    } else {
      groups.set(sig, {
        signature: sig,
        productId: line.productId,
        modifierIds: line.modifierIds,
        note: line.note,
        quantity: 1,
        lineIds: [line.id],
      });
    }
  }
  return [...groups.values()];
}
