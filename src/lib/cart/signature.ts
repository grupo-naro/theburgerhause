import { normalizeModifierIds } from "./normalize";

/** Two units with the same signature are "the same configuration" (grouped visually). */
export function signature(unit: { productId: number; modifierIds: readonly number[]; note: string }): string {
  const note = unit.note.replace(/\s+/g, " ").trim();
  return `${unit.productId}|${normalizeModifierIds(unit.modifierIds).join(",")}|${note}`;
}
