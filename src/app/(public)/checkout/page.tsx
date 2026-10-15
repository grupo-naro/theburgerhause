import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/checkout-view";
import { getCheckoutInfo } from "@/lib/menu/queries";

export const metadata: Metadata = {
  title: "Confirmar pedido — The Burger House 828",
  robots: { index: false },
};

/**
 * The cart lives in the browser, so the page is the CACHED checkout info (fee, bank data, store contact:
 * part of the static shell, refreshed by the settings tag) handed to a client component.
 */
export default async function CheckoutPage() {
  const info = await getCheckoutInfo();
  return <CheckoutView info={info} />;
}
