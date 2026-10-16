import type { OrderUnitInput } from "@/lib/cart/types";
import { cartSignature } from "@/lib/checkout/idempotency";

export type PosSignatureInput = {
  units: readonly OrderUnitInput[];
  payment: "cash" | "transfer" | null;
  pager: number | null;
  name: string;
};

const squash = (v: string) => v.replace(/\s+/g, " ").trim();

/**
 * Identity of the WHOLE counter sale: contents, payment, pager and name. Changing any of them gives
 * a new idempotency key (a new sale); an unchanged retry keeps it. Line order is irrelevant.
 */
export function posSignature(i: PosSignatureInput): string {
  return JSON.stringify([cartSignature(i.units), i.payment, i.pager, squash(i.name)]);
}
