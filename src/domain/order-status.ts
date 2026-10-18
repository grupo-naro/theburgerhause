export const ORDER_STATUSES = [
  "pendiente_aprobacion",
  "en_preparacion",
  "listo_despacho",
  "en_camino",
  "para_retirar",
  "entregado",
  "cancelado",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type Fulfillment = "delivery" | "takeaway";

const COMMON: Partial<Record<OrderStatus, readonly OrderStatus[]>> = {
  pendiente_aprobacion: ["en_preparacion", "cancelado"],
  en_preparacion: ["listo_despacho", "cancelado"],
  para_retirar: ["entregado", "cancelado"],
};

const BY_FULFILLMENT: Record<Fulfillment, Partial<Record<OrderStatus, readonly OrderStatus[]>>> = {
  delivery: { listo_despacho: ["en_camino", "cancelado"], en_camino: ["entregado", "listo_despacho"] },
  takeaway: { listo_despacho: ["para_retirar", "cancelado"] },
};

export function nextStatuses(from: OrderStatus, fulfillment: Fulfillment): OrderStatus[] {
  return [...(COMMON[from] ?? []), ...(BY_FULFILLMENT[fulfillment][from] ?? [])];
}

export function canTransition(from: OrderStatus, to: OrderStatus, fulfillment: Fulfillment): boolean {
  return nextStatuses(from, fulfillment).includes(to);
}

/**
 * The kitchen's "Deshacer": a ready order goes back to preparation, but only while nobody acted on it. `listo_despacho`
 * is the only such state: from `para_retirar` the pager was already called (the customer was told), `en_camino` has a
 * cadet, and later states are history. Deliberately NOT part of the forward table above.
 */
export function canUndoReady(from: OrderStatus): boolean {
  return from === "listo_despacho";
}
