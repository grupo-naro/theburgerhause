import type { DispatchBoard } from "@/lib/orders/dispatch-queries";

export type Selection = ReadonlySet<number>;
export type SelectionAction =
  | { type: "toggle"; id: number }
  | { type: "selectAll"; ids: readonly number[] }
  | { type: "clear" }
  | { type: "prune"; keep: readonly number[] };

/** Pure reducer for the set of selected delivery orders. Never mutates; `prune` keeps identity when nothing changes. */
export function selectionReducer(state: Selection, action: SelectionAction): Selection {
  switch (action.type) {
    case "toggle": {
      const next = new Set(state);
      if (!next.delete(action.id)) next.add(action.id);
      return next;
    }
    case "selectAll":
      return new Set([...state, ...action.ids]);
    case "clear":
      return state.size === 0 ? state : new Set();
    case "prune": {
      const keep = new Set(action.keep);
      const next = [...state].filter((id) => keep.has(id));
      return next.length === state.size ? state : new Set(next);
    }
  }
}

/** Selected ids that are still in the delivery-ready lane of the (refreshed) board. */
export function pruneSelection(selectedIds: Iterable<number>, board: Pick<DispatchBoard, "ready">): number[] {
  const ready = new Set(board.ready.delivery.map((o) => o.id));
  return [...selectedIds].filter((id) => ready.has(id));
}
