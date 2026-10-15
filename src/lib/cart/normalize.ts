import type { CartLine } from "./types";

export const NOTE_MAX = 140;

export function normalizeModifierIds(ids: readonly number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

/** Trimmed and capped; inner whitespace is kept (only the signature collapses it). */
export function normalizeNote(note: string): string {
  return note.trim().slice(0, NOTE_MAX).trim();
}

export function normalizeLine(line: CartLine): CartLine {
  return {
    id: line.id,
    productId: line.productId,
    modifierIds: normalizeModifierIds(line.modifierIds),
    note: normalizeNote(line.note),
  };
}
