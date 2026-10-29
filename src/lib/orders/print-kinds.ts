/**
 * Which tickets a station prints for an order. Pure: no db, no next/*.
 * Every approved order / counter sale prints the KITCHEN comanda on the same printer as the rest (the kitchen has no
 * printer of its own), then the customer ticket; Delivery stations add the delivery (dispatch) ticket for web delivery
 * orders. The agent prints by job id, so the order is kitchen -> customer -> delivery. (Task 10.2 had dropped the
 * kitchen comanda for a kitchen screen; the screen moved to the counter TV and the comanda is back.)
 */

/** `additional` = the kitchen comanda of one add-on; only enqueued by enqueueAddonPrintJobs, never part of a reprint selection. */
export type PrintKind = "kitchen" | "delivery" | "customer" | "additional";
/** Reprint selection. "both" keeps its old meaning (customer + delivery, WITHOUT the kitchen comanda): the kitchen is its own option. */
export type PrintWhich = Exclude<PrintKind, "additional"> | "both";
export type PrintStationKind = "mostrador" | "delivery";
type OrderShape = { channel: "web" | "counter"; fulfillment: "delivery" | "takeaway" };

/** Only web delivery orders have a delivery (dispatch) ticket: they carry an address and travel with a cadet. */
export function hasDeliveryTicket(order: OrderShape): boolean {
  return order.channel === "web" && order.fulfillment === "delivery";
}

export function defaultPrintKinds(stationKind: PrintStationKind, order: OrderShape): PrintKind[] {
  return stationKind === "delivery" && hasDeliveryTicket(order) ? ["kitchen", "customer", "delivery"] : ["kitchen", "customer"];
}

/** Reprint selection; null = the order has no such ticket ("delivery" asked for a non-delivery order). */
export function resolvePrintKinds(which: PrintWhich, stationKind: PrintStationKind, order: OrderShape): PrintKind[] | null {
  if (which === "both") return defaultPrintKinds(stationKind, order).filter((k) => k !== "kitchen");
  if (which === "kitchen") return ["kitchen"];
  if (which === "delivery") return hasDeliveryTicket(order) ? ["delivery"] : null;
  return ["customer"];
}
