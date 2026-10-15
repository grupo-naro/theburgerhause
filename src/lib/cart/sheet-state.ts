import { formatARS } from "@/domain/money";
import { unitTotal } from "@/domain/pricing";
import type { PublicModifier, PublicProduct } from "@/lib/menu/public";
import { NOTE_MAX, normalizeModifierIds, normalizeNote } from "./normalize";
import type { MenuIndex } from "./pricing";
import { toggleModifierInUnit } from "./reconcile";
import { MAX_UNITS_PER_ADD } from "./reducer";
import type { CartGroup, UnitConfig } from "./types";

/** Pure state of the product sheet (no React): one entry per physical unit being configured. */
export type SheetUnit = { modifierIds: number[]; note: string };

export type SheetState = {
  productId: number;
  mode: "add" | "edit";
  /** Edit mode: signature of the cart group being edited. */
  editSignature?: string;
  units: SheetUnit[];
  /** Index of the open accordion section (only meaningful with 2+ units). */
  expanded: number;
};

const emptyUnit = (): SheetUnit => ({ modifierIds: [], note: "" });
const cloneUnit = (u: SheetUnit): SheetUnit => ({ modifierIds: [...u.modifierIds], note: u.note });

export function initSheet(product: Pick<PublicProduct, "id">, opts: { editGroup?: CartGroup } = {}): SheetState {
  const group = opts.editGroup;
  if (!group) return { productId: product.id, mode: "add", units: [emptyUnit()], expanded: 0 };
  const unit: SheetUnit = { modifierIds: normalizeModifierIds(group.modifierIds), note: group.note };
  return {
    productId: product.id,
    mode: "edit",
    editSignature: group.signature,
    units: Array.from({ length: Math.max(1, group.quantity) }, () => cloneUnit(unit)),
    expanded: 0,
  };
}

/**
 * 1..10 units. Growing appends EMPTY units (use `copyFromFirst` to duplicate); shrinking truncates
 * from the end. An edited group that already has more than 10 identical units may shrink but not grow.
 */
export function setQuantity(state: SheetState, quantity: number): SheetState {
  if (!Number.isFinite(quantity)) return state;
  const cap = Math.max(MAX_UNITS_PER_ADD, state.units.length);
  const n = Math.min(Math.max(Math.floor(quantity), 1), cap);
  if (n === state.units.length) return state;
  const units =
    n > state.units.length
      ? [...state.units, ...Array.from({ length: n - state.units.length }, emptyUnit)]
      : state.units.slice(0, n);
  return { ...state, units, expanded: Math.min(state.expanded, n - 1) };
}

function withUnit(state: SheetState, unitIndex: number, unit: SheetUnit): SheetState {
  return { ...state, units: state.units.map((u, i) => (i === unitIndex ? unit : u)) };
}

/** Swap exclusivity per modifier group is the cart rule (`toggleModifierInUnit`). */
export function toggleModifier(
  state: SheetState,
  unitIndex: number,
  modifierId: number,
  menuIndex: MenuIndex,
): SheetState {
  const unit = state.units[unitIndex];
  const entry = menuIndex.modifiers.get(modifierId);
  if (!unit || !entry) return state;
  const modifierIds = toggleModifierInUnit(unit.modifierIds, entry.modifier, menuIndex);
  return withUnit(state, unitIndex, { ...unit, modifierIds });
}

const sameUnit = (a: SheetUnit, b: SheetUnit) =>
  a.note === b.note &&
  a.modifierIds.length === b.modifierIds.length &&
  a.modifierIds.every((id, i) => id === b.modifierIds[i]);

export function canCopyFromFirst(state: SheetState, unitIndex: number): boolean {
  const first = state.units[0];
  const unit = state.units[unitIndex];
  if (unitIndex <= 0 || !first || !unit) return false;
  if (first.modifierIds.length === 0 && first.note.trim() === "") return false;
  return !sameUnit(first, unit);
}

/** Copies unit 1's modifiers AND note into `unitIndex`. */
export function copyFromFirst(state: SheetState, unitIndex: number): SheetState {
  const first = state.units[0];
  if (unitIndex <= 0 || !first || !state.units[unitIndex]) return state;
  return withUnit(state, unitIndex, cloneUnit(first));
}

/** Capped at 140 characters; whitespace is kept while typing and trimmed by `toUnitConfigs`. */
export function setNote(state: SheetState, unitIndex: number, note: string): SheetState {
  const unit = state.units[unitIndex];
  if (!unit) return state;
  return withUnit(state, unitIndex, { ...unit, note: note.slice(0, NOTE_MAX) });
}

export function setExpanded(state: SheetState, expanded: number): SheetState {
  const e = Math.min(Math.max(expanded, 0), state.units.length - 1);
  return e === state.expanded ? state : { ...state, expanded: e };
}

/** Names of the unit's selected modifiers in display order (product group order, then modifier order). */
export function unitSummary(state: SheetState, unitIndex: number, menuIndex: MenuIndex): string[] {
  const unit = state.units[unitIndex];
  const product = menuIndex.products.get(state.productId);
  if (!unit || !product) return [];
  const selected = new Set(unit.modifierIds);
  return product.modifierGroups.flatMap((g) => g.modifiers.filter((m) => selected.has(m.id)).map((m) => m.name));
}

/** Cents, priced with the DOMAIN `unitTotal`; modifiers the product does not offer count as nothing. */
export function sheetTotal(state: SheetState, product: PublicProduct): number {
  const deltas = new Map(product.modifierGroups.flatMap((g) => g.modifiers.map((m) => [m.id, m.priceDelta] as const)));
  return state.units.reduce(
    (sum, u) =>
      sum +
      unitTotal({
        basePrice: product.price,
        modifiers: u.modifierIds.flatMap((id) => (deltas.has(id) ? [{ priceDelta: deltas.get(id)! }] : [])),
      }),
    0,
  );
}

export function toUnitConfigs(state: SheetState): UnitConfig[] {
  return state.units.map((u) => ({ modifierIds: normalizeModifierIds(u.modifierIds), note: normalizeNote(u.note) }));
}

/** What a modifier row / chip shows. The label is the name as stored ("Sin cheddar", "+ Dips"). */
export function modifierDisplay(modifier: PublicModifier): {
  label: string;
  priceLabel: string | null;
  kind: PublicModifier["kind"];
} {
  return {
    label: modifier.name,
    priceLabel: modifier.priceDelta > 0 ? `+ ${formatARS(modifier.priceDelta)}` : null,
    kind: modifier.kind,
  };
}
