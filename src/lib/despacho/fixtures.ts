import type { DispatchBoard, DispatchOrder } from "@/lib/orders/dispatch-queries";

/** Test fixtures for the dispatch helpers (not shipped: only the tests import it). */
export function order(over: Partial<DispatchOrder> & { id: number }): DispatchOrder {
  return {
    number: over.id,
    channel: "web",
    fulfillment: "delivery",
    status: "listo_despacho",
    paymentMethod: "cash",
    paymentStatus: "pending",
    total: 100_000,
    createdAt: "2026-10-15T15:00:00.000Z",
    minutesWaiting: 0,
    statusSince: "2026-10-15T15:00:00.000Z",
    minutesInStatus: 0,
    customerName: "Ana",
    address: "Calle 1",
    crossStreets: null,
    addressNotes: null,
    tanda: null,
    pagerNumber: null,
    items: [],
    printState: { pending: 0, failed: 0, done: 0 } as unknown as DispatchOrder["printState"],
    ...over,
  };
}

export function board(over: Partial<DispatchBoard> = {}): DispatchBoard {
  return { preparing: [], ready: { delivery: [], takeaway: [] }, pickup: [], enRoute: [], cadets: [], tandas: [], ...over };
}
