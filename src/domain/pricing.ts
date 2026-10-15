import { assertCents } from "@/domain/money";

export type UnitInput = { basePrice: number; modifiers: { priceDelta: number }[] };

export function unitTotal(unit: UnitInput): number {
  assertCents(unit.basePrice);
  return unit.modifiers.reduce((sum, m) => {
    assertCents(m.priceDelta);
    return sum + m.priceDelta;
  }, unit.basePrice);
}

export function orderTotals(units: UnitInput[], deliveryFee: number) {
  if (units.length === 0) throw new Error("El pedido debe tener al menos una unidad");
  assertCents(deliveryFee);
  const subtotal = units.reduce((sum, u) => sum + unitTotal(u), 0);
  return { subtotal, total: subtotal + deliveryFee };
}
