"use client";

import Link from "next/link";
import { useState } from "react";
import { BagIcon } from "@/components/menu/icons";
import { useCart } from "./cart-provider";

/** Header cart button: unit-count badge (hidden at 0, "99+" cap), bumps when the count goes up. */
export function CartButton() {
  const { count, ready } = useCart();

  // Derived-state pattern (no effect): remember the previous render to detect an increase.
  const [prev, setPrev] = useState({ count, ready });
  const [bump, setBump] = useState(0);
  if (prev.count !== count || prev.ready !== ready) {
    setPrev({ count, ready });
    // Only a real add counts: the jump from the empty first render to the stored cart is not a bump.
    if (prev.ready && ready && count > prev.count) setBump((n) => n + 1);
  }

  return (
    <Link
      href="/carrito"
      aria-label={count > 0 ? `Ver pedido, ${count} ${count === 1 ? "producto" : "productos"}` : "Ver pedido"}
      data-testid="cart-button"
      data-ready={ready}
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 focus-visible:outline-white"
    >
      <BagIcon className="size-6" />
      {count > 0 && (
        <span
          key={bump}
          aria-hidden="true"
          data-testid="cart-count"
          className={`absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-cheddar-400 px-1 text-xs font-bold tabular-nums leading-none text-ink ring-2 ring-brand-600 ${bump > 0 ? "animate-cart-bump" : ""}`}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
