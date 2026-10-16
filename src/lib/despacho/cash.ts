import { assertCents } from "@/domain/money";

type Payable = { paymentMethod: "cash" | "transfer"; paymentStatus: "pending" | "paid"; total: number };

/**
 * Centavos the cadet must collect for these orders: the totals of the cash orders still pending
 * payment. Integer-cent sums only (the only place the board adds money up).
 */
export function cashToCollect(orders: ReadonlyArray<Payable>): number {
  let sum = 0;
  for (const o of orders) {
    assertCents(o.total);
    if (o.paymentMethod === "cash" && o.paymentStatus === "pending") sum += o.total;
  }
  return sum;
}

/** A takeaway order paid in cash must be charged at the counter before it is handed over. */
export function needsCollection(o: Payable & { fulfillment: "delivery" | "takeaway" }): boolean {
  return o.fulfillment === "takeaway" && o.paymentMethod === "cash" && o.paymentStatus === "pending";
}
