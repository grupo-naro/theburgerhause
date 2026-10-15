import { orderTotals, type UnitInput } from "@/domain/pricing";
import { unitInputFor, type MenuIndex } from "@/lib/cart/pricing";
import type { CartLine } from "@/lib/cart/types";
import type { Fulfillment } from "./form";

export type CheckoutPreview = { subtotal: number; deliveryFee: number; total: number };

/**
 * PREVIEW of what the order will cost (the server recomputes from the DB): domain `orderTotals` over
 * the cart units, with the delivery fee only for delivery. Never throws (an empty cart is 0).
 */
export function checkoutPreview(
  lines: readonly CartLine[],
  index: MenuIndex,
  fulfillment: Fulfillment,
  deliveryFee: number,
): CheckoutPreview {
  const fee = fulfillment === "delivery" ? deliveryFee : 0;
  const units = lines.flatMap((l): UnitInput[] => {
    const input = unitInputFor(l, index);
    return input ? [input] : [];
  });
  if (units.length === 0) return { subtotal: 0, deliveryFee: fee, total: fee };
  const { subtotal, total } = orderTotals(units, fee);
  return { subtotal, deliveryFee: fee, total };
}
