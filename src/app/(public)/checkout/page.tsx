import type { Metadata } from "next";
import Link from "next/link";
import { StatePanel } from "@/components/menu/state-panel";

export const metadata: Metadata = {
  title: "Finalizar pedido — The Burger House 828",
  robots: { index: false },
};

// Placeholder: Task 4.3 replaces this page with the real checkout form.
export default function CheckoutPage() {
  return (
    <StatePanel
      heading="h1"
      title="Estamos terminando esta pantalla"
      actions={
        <Link
          href="/carrito"
          className="inline-flex min-h-12 items-center rounded-full bg-brand-600 px-6 font-display text-base font-bold text-white transition-colors hover:bg-brand-700"
        >
          Volver a tu pedido
        </Link>
      }
    >
      Muy pronto vas a poder confirmar tu pedido desde acá.
    </StatePanel>
  );
}
