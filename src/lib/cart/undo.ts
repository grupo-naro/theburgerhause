import { signature } from "./signature";
import type { CartLine } from "./types";

/** How long "Deshacer" works after removing a group. */
export const UNDO_TTL_MS = 6000;

export type RemovedItem = { index: number; line: CartLine };
export type UndoEntry = { items: RemovedItem[]; at: number };

/** Removes a whole group and remembers where each of its units sat. Null when the group does not exist. */
export function takeGroup(
  lines: readonly CartLine[],
  groupSignature: string,
  now: number,
): { lines: CartLine[]; entry: UndoEntry } | null {
  const items: RemovedItem[] = [];
  const kept: CartLine[] = [];
  lines.forEach((line, index) => {
    if (signature(line) === groupSignature) items.push({ index, line });
    else kept.push(line);
  });
  return items.length === 0 ? null : { lines: kept, entry: { items, at: now } };
}

/**
 * Puts removed units back at their original positions (ascending, so earlier insertions keep later
 * indexes valid); an index past the end is clamped; units already in the cart are skipped.
 */
export function restoreRemoved(lines: readonly CartLine[], items: readonly RemovedItem[]): CartLine[] {
  const present = new Set(lines.map((l) => l.id));
  const next = [...lines];
  for (const { index, line } of [...items].sort((a, b) => a.index - b.index)) {
    if (present.has(line.id)) continue;
    next.splice(Math.min(index, next.length), 0, line);
  }
  return next;
}

export function isUndoExpired(entry: UndoEntry | null, now: number, ttl = UNDO_TTL_MS): boolean {
  return !entry || now - entry.at >= ttl;
}
