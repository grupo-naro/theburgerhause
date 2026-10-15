import { groupLines } from "./group";
import { normalizeLine, normalizeModifierIds, normalizeNote } from "./normalize";
import { signature } from "./signature";
import { restoreRemoved } from "./undo";
import type { CartAction, CartLine, CartState, UnitConfig } from "./types";

/**
 * Limits (documented decision: over-limit actions are IGNORED, the reducer returns the very
 * same state object; the UI asks `canAdd` first to disable the control and explain why).
 * - MAX_UNITS_PER_ADD: units one "add" / product-sheet confirmation may carry (UX: quantity 1-10).
 * - MAX_LINES: physical units in the whole cart.
 * - MAX_GROUP_QUANTITY: identical units (same signature) that can be grouped; setGroupQuantity clamps to it.
 */
export const MAX_UNITS_PER_ADD = 10;
export const MAX_LINES = 100;
export const MAX_GROUP_QUANTITY = 99;

export const emptyCart: CartState = { lines: [] };

function withinLimits(lines: readonly CartLine[]): boolean {
  if (lines.length > MAX_LINES) return false;
  return groupLines(lines).every((g) => g.quantity <= MAX_GROUP_QUANTITY);
}

function toLine(productId: number, unit: UnitConfig, id: string): CartLine {
  return {
    id,
    productId,
    modifierIds: normalizeModifierIds(unit.modifierIds),
    note: normalizeNote(unit.note),
  };
}

/** Pure check for "can I add `count` units of `productId`?" (pass `units` to also check the per-group cap). */
export function canAdd(
  state: CartState,
  productId: number,
  count: number,
  units?: readonly UnitConfig[],
): boolean {
  if (!Number.isInteger(count) || count < 1 || count > MAX_UNITS_PER_ADD) return false;
  if (state.lines.length + count > MAX_LINES) return false;
  if (!units) return true;
  const probe = [...state.lines, ...units.map((u, i) => toLine(productId, u, `probe-${i}`))];
  return withinLimits(probe);
}

export function cartReducer(state: CartState, action: CartAction, newId: () => string): CartState {
  switch (action.type) {
    case "add": {
      if (!canAdd(state, action.productId, action.units.length, action.units)) return state;
      const added = action.units.map((u) => toLine(action.productId, u, newId()));
      return { lines: [...state.lines, ...added] };
    }
    case "removeLine": {
      const lines = state.lines.filter((l) => l.id !== action.id);
      return lines.length === state.lines.length ? state : { lines };
    }
    case "removeLines": {
      const drop = new Set(action.ids);
      const lines = state.lines.filter((l) => !drop.has(l.id));
      return lines.length === state.lines.length ? state : { lines };
    }
    case "removeGroup": {
      const lines = state.lines.filter((l) => signature(l) !== action.signature);
      return lines.length === state.lines.length ? state : { lines };
    }
    case "setGroupQuantity": {
      if (!Number.isFinite(action.quantity)) return state;
      const target = Math.min(Math.max(Math.floor(action.quantity), 0), MAX_GROUP_QUANTITY);
      const group = groupLines(state.lines).find((g) => g.signature === action.signature);
      if (!group || target === group.quantity) return state;
      if (target < group.quantity) {
        // Decrease: drop units from the END of the group.
        const drop = new Set(group.lineIds.slice(target));
        return { lines: state.lines.filter((l) => !drop.has(l.id)) };
      }
      const extra = Math.min(target - group.quantity, MAX_LINES - state.lines.length);
      if (extra <= 0) return state;
      const template = state.lines.find((l) => l.id === group.lineIds[0])!;
      const clones = Array.from({ length: extra }, () => ({ ...template, modifierIds: [...template.modifierIds], id: newId() }));
      // Clones sit right after the group's last unit so the group stays visually together.
      const lastId = group.lineIds[group.lineIds.length - 1];
      const at = state.lines.findIndex((l) => l.id === lastId) + 1;
      return { lines: [...state.lines.slice(0, at), ...clones, ...state.lines.slice(at)] };
    }
    case "replaceGroup": {
      if (action.units.length < 1 || action.units.length > MAX_GROUP_QUANTITY) return state;
      const group = groupLines(state.lines).find((g) => g.signature === action.signature);
      if (!group) return state;
      const ids = new Set(group.lineIds);
      const first = state.lines.findIndex((l) => ids.has(l.id));
      const replacement = action.units.map((u) => toLine(action.productId, u, newId()));
      const before = state.lines.slice(0, first).filter((l) => !ids.has(l.id));
      const after = state.lines.slice(first).filter((l) => !ids.has(l.id));
      const lines = [...before, ...replacement, ...after];
      return withinLimits(lines) ? { lines } : state;
    }
    case "restore": {
      const lines = restoreRemoved(state.lines, action.items).map(normalizeLine);
      return lines.length === state.lines.length || !withinLimits(lines) ? state : { lines };
    }
    case "clear":
      return state.lines.length === 0 ? state : emptyCart;
    case "hydrate":
      return { lines: action.lines.slice(0, MAX_LINES).map(normalizeLine) };
  }
}
