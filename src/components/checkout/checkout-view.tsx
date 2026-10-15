"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { CheckoutInfo } from "@/lib/settings/checkout-info";
import { CheckoutContent } from "./checkout-content";
import { CheckoutSkeleton } from "./checkout-skeleton";

const noopSubscribe = () => () => {};

/** False during SSR / hydration, true afterwards: browser-only state (localStorage) is read after that. */
function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** `/checkout`: heading + the interactive content, which only mounts on the client. */
export function CheckoutView({ info }: { info: CheckoutInfo }) {
  const hydrated = useHydrated();
  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-8 pt-6 md:pt-8">
      <Link href="/carrito" className="inline-flex min-h-11 items-center text-sm font-bold text-brand-600">
        ← Volver a tu pedido
      </Link>
      <h1 className="font-display text-3xl font-extrabold text-ink md:text-4xl">Confirmar pedido</h1>
      <div className="mt-5">{hydrated ? <CheckoutContent info={info} /> : <CheckoutSkeleton />}</div>
    </div>
  );
}
