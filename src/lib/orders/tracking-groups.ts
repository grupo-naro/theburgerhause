import { unitTotal } from "@/domain/pricing";

/** Pure grouping of order unit rows (snapshot columns only) into the customer-facing lines. */

export type SnapshotModifier = { modifierId?: number | null; name: string; priceDelta: number; kitchenLabel?: string };
export type SnapshotItem = {
  /** Used only to decide which units are identical; never part of the output. */
  productId: number | null;
  name: string;
  unitPrice: number;
  note: string | null;
  modifiers: SnapshotModifier[];
  /** Staff views: seq of the add-on the unit belongs to (null = the original order). Omitted = not tracked. */
  addonSeq?: number | null;
  /** Staff views: the order_items id of this unit (lets an editor address one unit). Omitted = not tracked. */
  id?: number;
};

export type TrackingGroup = {
  name: string;
  quantity: number;
  /** `kitchenLabel` is carried through only when the input units provide it (staff views). */
  modifiers: { name: string; priceDelta: number; kitchenLabel?: string }[];
  note: string | null;
  unitTotal: number;
  lineTotal: number;
  /** Staff views only: seq of the add-on this line belongs to (null = original order). Absent in the public tracking. */
  addonSeq?: number | null;
  /** Staff views only: the order_items ids of the units in this line (one per unit). Absent when ids are not tracked. */
  itemIds?: number[];
};

const modKey = (m: SnapshotModifier) => (m.modifierId != null ? `#${m.modifierId}` : `n:${m.name}`);

function signature(i: SnapshotItem): string {
  const mods = i.modifiers.map(modKey).sort().join(",");
  return JSON.stringify([i.productId ?? `n:${i.name}`, i.unitPrice, mods, i.note ?? null, i.addonSeq ?? null]);
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
      if (i.id !== undefined) found.itemIds?.push(i.id);
      continue;
    }
    const total = unitTotal({ basePrice: i.unitPrice, modifiers: i.modifiers });
    byKey.set(key, {
      name: i.name,
      quantity: 1,
      modifiers: i.modifiers.map((m) => ({
        name: m.name,
        priceDelta: m.priceDelta,
        ...(m.kitchenLabel !== undefined ? { kitchenLabel: m.kitchenLabel } : {}),
      })),
      note: i.note,
      unitTotal: total,
      lineTotal: total,
      ...(i.addonSeq !== undefined ? { addonSeq: i.addonSeq } : {}),
      ...(i.id !== undefined ? { itemIds: [i.id] } : {}),
    });
  }
  const groups = [...byKey.values()];
  return { groups, subtotal: groups.reduce((sum, g) => sum + g.lineTotal, 0) };
}
