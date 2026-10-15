import { describe, expect, it } from "vitest";
import { cadetBalance, type BalanceOrder } from "@/domain/cadet-balance";

const o = (p: Partial<BalanceOrder>): BalanceOrder => ({
  id: 1, total: 1_000_000, paymentMethod: "cash", paymentStatus: "pending",
  status: "entregado", cadetId: 7, ...p,
});

describe("cadetBalance", () => {
  it("suma solo efectivo entregado y pendiente del cadete", () => {
    const orders = [
      o({ id: 1, total: 1_000_000 }),
      o({ id: 2, total: 500_000 }),
      o({ id: 3, paymentMethod: "transfer" }),
      o({ id: 4, paymentStatus: "paid" }),
      o({ id: 5, cadetId: 9 }),
      o({ id: 6, status: "cancelado" }),
    ];
    expect(cadetBalance(orders, 7)).toEqual({ owed: 1_500_000, orderIds: [1, 2], inRoute: 0 });
  });
  it("cuenta aparte los pedidos en camino", () => {
    expect(cadetBalance([o({ id: 1, status: "en_camino" })], 7)).toEqual({ owed: 0, orderIds: [], inRoute: 1 });
  });
  it("sin pedidos el saldo es cero", () => {
    expect(cadetBalance([], 7)).toEqual({ owed: 0, orderIds: [], inRoute: 0 });
  });
});
