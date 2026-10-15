"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOrdersOpen } from "@/components/menu/store-status";
import { formatARS } from "@/domain/money";
import { useCart } from "./cart-provider";

/** Pages that own the whole screen for the order: the bar would only get in the way. */
const HIDDEN_ON = (path: string) =>
  path === "/carrito" || path === "/checkout" || path === "/pedido" || path.startsWith("/pedido/");

/**
 * Bottom "Ver pedido · N · $total" bar. Shown only with a loaded, non-empty cart while orders are open
 * (when closed, the floating closed notice owns the bottom edge). `data-floating-ui` makes the footer
 * reserve room for it.
 */
export function OrderBar() {
  const { ready, count, subtotal } = useCart();
  const ordersOpen = useOrdersOpen();
  const pathname = usePathname();
  if (!ready || count === 0 || !ordersOpen || HIDDEN_ON(pathname)) return null;
  return (
    <div
      data-floating-ui
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 md:inset-x-3 md:mx-auto md:max-w-xl md:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <Link
        href="/carrito"
        data-testid="order-bar"
        className="pointer-events-auto flex min-h-14 animate-bar-in items-center justify-center gap-2 bg-cheddar-400 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 font-display text-lg font-extrabold text-ink shadow-[0_-6px_20px_rgba(11,31,58,0.22)] transition-colors hover:bg-cheddar-600 focus-visible:outline-ink md:rounded-full md:pb-2 md:shadow-[0_8px_24px_rgba(11,31,58,0.3)]"
      >
        <span>Ver pedido</span>
        {" "}
        <span aria-hidden="true">·</span>
        {" "}
        <span data-testid="order-bar-count" className="tabular-nums">
          {count}
        </span>
        {" "}
        <span aria-hidden="true">·</span>
        {" "}
        <span data-testid="order-bar-total" aria-live="polite" className="tabular-nums">
          {formatARS(subtotal)}
        </span>
      </Link>
    </div>
  );
}
