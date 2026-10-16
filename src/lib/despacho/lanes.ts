import type { DispatchBoard } from "@/lib/orders/dispatch-queries";

export type LaneCounts = {
  preparing: number;
  ready: number;
  readyDelivery: number;
  readyCounter: number;
  pickup: number;
  enRoute: number;
};

export function laneCounts(b: DispatchBoard): LaneCounts {
  return {
    preparing: b.preparing.length,
    ready: b.ready.delivery.length + b.ready.takeaway.length,
    readyDelivery: b.ready.delivery.length,
    readyCounter: b.ready.takeaway.length,
    pickup: b.pickup.length,
    enRoute: b.enRoute.reduce((n, g) => n + g.orders.length, 0),
  };
}
