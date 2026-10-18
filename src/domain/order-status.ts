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
