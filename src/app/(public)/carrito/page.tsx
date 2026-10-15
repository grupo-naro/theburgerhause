import type { Metadata } from "next";
import { CartView } from "@/components/cart/cart-view";

export const metadata: Metadata = {
  title: "Tu pedido — The Burger House 828",
  robots: { index: false },
};

/** Client content: the cart lives in the browser (localStorage), the menu comes from the layout provider. */
export default function CartPage() {
  return <CartView />;
}
