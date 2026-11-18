import type { PrintableItem, PrintableModifier, PrintableOrder } from "@/domain/print-document";

/**
 * Pure mapper: DB SNAPSHOT columns -> the domain `PrintableOrder`. Never reads live catalog data,
 * so a ticket always reflects what the customer ordered. No next/* and no DB access here.
 */

export type PrintableOrderRow = Omit<PrintableOrder, "items" | "customerName"> & {
  customerName: string | null;
};
export type PrintableItemRow = {
  id: number;
  nameSnapshot: string;
  unitPriceSnapshot: number;
  notes: string | null;
  addonSeq: number | null;
  /** order_items.combo_snapshot (jsonb): a combo's contents at sale time, or null. */
  comboSnapshot?: unknown;
};

/** Only well-formed `[{ name, quantity }]` snapshots reach the tickets; anything else prints as a plain item. */
function comboItemsOf(snapshot: unknown): { name: string; quantity: number }[] | undefined {
  if (!Array.isArray(snapshot) || snapshot.length === 0) return undefined;
  const ok = snapshot.every(
    (c) => c && typeof c === "object" && typeof (c as { name?: unknown }).name === "string" && Number.isInteger((c as { quantity?: unknown }).quantity),
  );
  return ok ? snapshot.map((c: { name: string; quantity: number }) => ({ name: c.name, quantity: c.quantity })) : undefined;
}
export type PrintableModifierRow = {
  id: number;
  orderItemId: number;
  nameSnapshot: string;
  kitchenLabel: string;
  kind: PrintableModifier["kind"];
  priceDelta: number;
};

export function orderToPrintable(
  order: PrintableOrderRow,
  items: readonly PrintableItemRow[],
  modifiers: readonly PrintableModifierRow[],
): PrintableOrder {
  const byItem = new Map<number, PrintableModifierRow[]>();
  for (const m of modifiers) {
    const list = byItem.get(m.orderItemId);
    if (list) list.push(m);
    else byItem.set(m.orderItemId, [m]);
  }
  const units: PrintableItem[] = [...items]
    .sort((a, b) => a.id - b.id)
    .map((i) => ({
      name: i.nameSnapshot,
      unitPrice: i.unitPriceSnapshot,
      note: i.notes,
      addonSeq: i.addonSeq,
      ...(comboItemsOf(i.comboSnapshot) ? { comboItems: comboItemsOf(i.comboSnapshot) } : {}),
      modifiers: (byItem.get(i.id) ?? [])
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((m) => ({ name: m.nameSnapshot, kitchenLabel: m.kitchenLabel, kind: m.kind, priceDelta: m.priceDelta })),
    }));
  return {
    number: order.number,
    channel: order.channel,
    fulfillment: order.fulfillment,
    createdAt: order.createdAt,
    customerName: order.customerName,
    whatsapp: order.whatsapp,
    address: order.address,
    crossStreets: order.crossStreets,
    addressNotes: order.addressNotes,
    pagerNumber: order.pagerNumber,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    items: units,
  };
}
