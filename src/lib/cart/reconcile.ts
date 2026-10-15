import { normalizeModifierIds } from "./normalize";
import { unitTotalFor, type MenuIndex } from "./pricing";
import type { CartIssue, CartLine } from "./types";
import type { PublicModifier } from "@/lib/menu/public";

export type ReconcileOptions = {
  /** productId -> name, supplied by the caller (the previous menu is gone). Only used in messages. */
  names?: Record<number, string>;
  /** lineId -> unit total when the line was added / last seen. Used to flag `price_changed`. */
  lastSeenPrices?: Record<string, number>;
};

/**
 * Brings a (possibly stale) cart in line with the current menu. Pure and idempotent:
 * feeding `lines` + `prices` of the result back in produces no issues. Never throws.
 * Issues are aggregated (one per product / change) with the number of affected units.
 */
export function reconcileCart(
  lines: readonly CartLine[],
  index: MenuIndex,
  options: ReconcileOptions = {},
): { lines: CartLine[]; issues: CartIssue[]; prices: Record<string, number> } {
  const kept: CartLine[] = [];
  const prices: Record<string, number> = {};
  const dropped = new Map<number, number>();
  const stripped = new Map<string, { productId: number; modifierIds: number[]; quantity: number }>();
  const changed = new Map<string, { productId: number; from: number; to: number; quantity: number }>();

  for (const line of lines) {
    const product = index.products.get(line.productId);
    if (!product) {
      dropped.set(line.productId, (dropped.get(line.productId) ?? 0) + 1);
      continue;
    }
    const offered = index.offered.get(product.id);
    const valid = line.modifierIds.filter((id) => offered?.has(id));
    const gone = line.modifierIds.filter((id) => !offered?.has(id));
    const next: CartLine = valid.length === line.modifierIds.length ? line : { ...line, modifierIds: normalizeModifierIds(valid) };
    if (gone.length > 0) {
      const key = `${product.id}|${gone.join(",")}`;
      const entry = stripped.get(key) ?? { productId: product.id, modifierIds: gone, quantity: 0 };
      entry.quantity += 1;
      stripped.set(key, entry);
    }
    const now = unitTotalFor(next, index);
    const before = options.lastSeenPrices?.[line.id];
    if (before !== undefined && before !== now && gone.length === 0) {
      const key = `${product.id}|${before}|${now}`;
      const entry = changed.get(key) ?? { productId: product.id, from: before, to: now, quantity: 0 };
      entry.quantity += 1;
      changed.set(key, entry);
    }
    prices[line.id] = now;
    kept.push(next);
  }

  const issues: CartIssue[] = [
    ...[...dropped].map(([productId, quantity]): CartIssue => {
      const name = options.names?.[productId];
      return name === undefined
        ? { type: "product_unavailable", productId, quantity }
        : { type: "product_unavailable", productId, name, quantity };
    }),
    ...[...stripped.values()].map((s): CartIssue => ({ type: "modifier_unavailable", ...s })),
    ...[...changed.values()].map((c): CartIssue => ({ type: "price_changed", ...c })),
  ];
  return { lines: kept, issues, prices };
}

/**
 * Selection rule for one unit. remove/add kinds toggle freely; `swap` modifiers are exclusive
 * within their modifier group (selecting one deselects the others of the group; selecting the
 * selected one deselects it). Returns a new sorted array.
 */
export function toggleModifierInUnit(
  selectedIds: readonly number[],
  modifier: PublicModifier,
  index: MenuIndex,
): number[] {
  if (selectedIds.includes(modifier.id)) {
    return normalizeModifierIds(selectedIds.filter((id) => id !== modifier.id));
  }
  let next = [...selectedIds];
  if (modifier.kind === "swap") {
    const groupId = index.modifiers.get(modifier.id)?.groupId;
    if (groupId !== undefined) {
      next = next.filter((id) => {
        const other = index.modifiers.get(id);
        return !(other && other.groupId === groupId && other.modifier.kind === "swap");
      });
    }
  }
  return normalizeModifierIds([...next, modifier.id]);
}
