import { formatARS } from "@/domain/money";
import type { TrackingGroup } from "./tracking-groups";

/** Pure logic of the order editor dialog (no React): what each unit is worth, the new total and the payment copy. */

/** One unit of the order, addressable by its order_items id. `total` = base + modifiers, centavos. */
export type EditorItem = { id: number; label: string; total: number; addonSeq: number | null };

/** The grouped lines of a staff order -> one EditorItem per unit (groups without tracked ids are skipped). */
export function editorItemsFromGroups(groups: readonly TrackingGroup[]): EditorItem[] {
  return groups.flatMap((g) => {
    const mods = g.modifiers.map((m) => (m.kitchenLabel ?? m.name).toUpperCase());
    const label = [g.name, ...mods, ...(g.note ? [`Nota: ${g.note}`] : [])].join(" · ");
    return (g.itemIds ?? []).map((id) => ({ id, label, total: g.unitTotal, addonSeq: g.addonSeq ?? null }));
  });
}

/** Sum of the units that stay (not in `removedIds`). */
export function keptSubtotal(items: readonly EditorItem[], removedIds: ReadonlySet<number>): number {
  return items.reduce((sum, i) => (removedIds.has(i.id) ? sum : sum + i.total), 0);
}

/**
 * Total of an edited pending order: kept units + new units (already priced) + the delivery fee, which an
 * edit never recalculates (same rule as the server).
 */
export function editedTotal(args: {
  items: readonly EditorItem[];
  removedIds: ReadonlySet<number>;
  addedSubtotal: number;
  deliveryFee: number;
}): number {
  return keptSubtotal(args.items, args.removedIds) + args.addedSubtotal + args.deliveryFee;
}

/** How many units the order would have after the edit (the server refuses an empty order). */
export function unitsAfterEdit(items: readonly EditorItem[], removedIds: ReadonlySet<number>, addedCount: number): number {
  return items.filter((i) => !removedIds.has(i.id)).length + addedCount;
}

/** What the staff has to tell the customer / do with the money of an add-on of `amount` centavos. */
export function addonPaymentCopy(args: { channel: "web" | "counter"; paymentMethod: "cash" | "transfer"; amount: number }): string {
  const amount = formatARS(args.amount);
  if (args.channel === "counter") return `Cobrá ${amount} ahora`;
  return args.paymentMethod === "transfer"
    ? `Queda pendiente hasta confirmar la transferencia de ${amount}`
    : `Se cobra ${amount} al entregar`;
}
