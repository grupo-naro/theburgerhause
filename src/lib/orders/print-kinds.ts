/**
 * Which tickets a station prints for an order (Task 10.2). Pure: no db, no next/*.
 * Delivery stations print the customer ticket first, then the delivery (dispatch) ticket (the agent prints in job-id order); Mostrador stations print only
 * the customer ticket. The kitchen comanda is NOT printed (the KDS screen of a later phase replaces it).
 */

export type PrintKind = "delivery" | "customer";
export type PrintWhich = PrintKind | "both";
export type PrintStationKind = "mostrador" | "delivery";
type OrderShape = { channel: "web" | "counter"; fulfillment: "delivery" | "takeaway" };

/** Only web delivery orders have a delivery (dispatch) ticket: they carry an address and travel with a cadet. */
export function hasDeliveryTicket(order: OrderShape): boolean {
  return order.channel === "web" && order.fulfillment === "delivery";
}

export function defaultPrintKinds(stationKind: PrintStationKind, order: OrderShape): PrintKind[] {
  return stationKind === "delivery" && hasDeliveryTicket(order) ? ["customer", "delivery"] : ["customer"];
}

/** Reprint selection; null = the order has no such ticket ("delivery" asked for a non-delivery order). */
export function resolvePrintKinds(which: PrintWhich, stationKind: PrintStationKind, order: OrderShape): PrintKind[] | null {
  if (which === "both") return defaultPrintKinds(stationKind, order);
  if (which === "delivery") return hasDeliveryTicket(order) ? ["delivery"] : null;
  return ["customer"];
}
