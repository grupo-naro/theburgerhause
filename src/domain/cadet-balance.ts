import type { OrderStatus } from "@/domain/order-status";

export type BalanceOrder = {
  id: number;
  total: number;
  paymentMethod: "cash" | "transfer";
  paymentStatus: "pending" | "paid";
  status: OrderStatus;
  cadetId: number | null;
};

export function cadetBalance(orders: BalanceOrder[], cadetId: number) {
  const mine = orders.filter((o) => o.cadetId === cadetId);
  const owing = mine.filter(
    (o) => o.status === "entregado" && o.paymentMethod === "cash" && o.paymentStatus === "pending",
  );
  return {
    owed: owing.reduce((sum, o) => sum + o.total, 0),
    orderIds: owing.map((o) => o.id),
    inRoute: mine.filter((o) => o.status === "en_camino").length,
  };
}
