import type { PrintableItem, PrintableModifier, PrintableOrder } from "@/domain/print-document";

/**
 * Pure mapper: DB SNAPSHOT columns -> the domain `PrintableOrder`. Never reads live catalog data,
 * so a ticket always reflects what the customer ordered. No next/* and no DB access here.
 */

export type PrintableOrderRow = Omit<PrintableOrder, "items" | "customerName"> & {
  customerName: string | null;
};
export type PrintableItemRow = { id: number; nameSnapshot: string; unitPriceSnapshot: number; notes: string | null; addonSeq: number | null };
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
