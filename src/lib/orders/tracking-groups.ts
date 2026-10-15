import { unitTotal } from "@/domain/pricing";

/** Pure grouping of order unit rows (snapshot columns only) into the customer-facing lines. */

export type SnapshotModifier = { modifierId?: number | null; name: string; priceDelta: number };
export type SnapshotItem = {
  /** Used only to decide which units are identical; never part of the output. */
  productId: number | null;
  name: string;
  unitPrice: number;
  note: string | null;
  modifiers: SnapshotModifier[];
};

export type TrackingGroup = {
  name: string;
  quantity: number;
  modifiers: { name: string; priceDelta: number }[];
  note: string | null;
  unitTotal: number;
  lineTotal: number;
};

const modKey = (m: SnapshotModifier) => (m.modifierId != null ? `#${m.modifierId}` : `n:${m.name}`);

function signature(i: SnapshotItem): string {
  const mods = i.modifiers.map(modKey).sort().join(",");
  return JSON.stringify([i.productId ?? `n:${i.name}`, i.unitPrice, mods, i.note ?? null]);
}

/** Identical units (product + modifiers + note) collapse into one line; order = first appearance. */
export function groupTrackingItems(items: SnapshotItem[]): { groups: TrackingGroup[]; subtotal: number } {
  const byKey = new Map<string, TrackingGroup>();
  for (const i of items) {
    const key = signature(i);
    const found = byKey.get(key);
    if (found) {
      found.quantity += 1;
      found.lineTotal += found.unitTotal;
      continue;
    }
    const total = unitTotal({ basePrice: i.unitPrice, modifiers: i.modifiers });
    byKey.set(key, {
      name: i.name,
      quantity: 1,
      modifiers: i.modifiers.map((m) => ({ name: m.name, priceDelta: m.priceDelta })),
      note: i.note,
      unitTotal: total,
      lineTotal: total,
    });
  }
  const groups = [...byKey.values()];
  return { groups, subtotal: groups.reduce((sum, g) => sum + g.lineTotal, 0) };
}
