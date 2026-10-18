"use client";

import Link from "next/link";
import { useMenuIndex } from "@/components/menu/menu-provider";
import { StatePanel } from "@/components/menu/state-panel";
import { useOrdersOpen } from "@/components/menu/store-status";
import { useProductSheet } from "@/components/product/sheet-context";
import { useToast } from "@/components/ui/toast";
import type { CartGroup } from "@/lib/cart/types";
import { UNDO_TTL_MS } from "@/lib/cart/undo";
import { CartLine } from "./cart-line";
import { useCart } from "./cart-provider";
import { CartSkeleton } from "./cart-skeleton";
import { CartSummary } from "./cart-summary";
import { IssuesBanner } from "./issues-banner";

/** The `/carrito` content: groups with steppers, issues banner, subtotal and the way to checkout. */
export function CartView() {
  const index = useMenuIndex();
  const cart = useCart();
  const ordersOpen = useOrdersOpen();
  const sheet = useProductSheet();
  const toast = useToast();

  const groups = cart.groups.filter((g) => index.products.has(g.productId));

  function remove(group: CartGroup) {
    cart.removeGroup(group.signature);
    toast.show({
      message: "Quitado",
      action: { label: "Deshacer", onClick: () => cart.undoRemoval() },
      durationMs: UNDO_TTL_MS,
    });
  }

  // min-h-svh below lg: the footer starts below the first screen, so the cart filling in after hydration
  // (it lives in localStorage) cannot shift it into view (CLS).
  return (
    <div className="mx-auto min-h-svh max-w-[1100px] px-4 pb-6 pt-6 md:pt-8 lg:min-h-[60svh]">
      <h1 className="font-display text-3xl font-extrabold text-ink md:text-4xl">Tu pedido</h1>
      <div className="mt-5" data-testid="cart-view" data-ready={cart.ready}>
        <IssuesBanner issues={cart.issues} index={index} onDismiss={cart.dismissIssues} />
        {!cart.ready ? (
          <CartSkeleton />
        ) : groups.length === 0 ? (
          <StatePanel
            title="Tu pedido está vacío"
            actions={
              <Link
                href="/"
                className="inline-flex min-h-12 items-center rounded-full bg-cheddar-400 px-6 font-display text-lg font-extrabold text-ink shadow-sm transition-colors hover:bg-cheddar-600"
              >
                Ver la carta
              </Link>
            }
          >
            Elegí algo rico de la carta y armalo a tu gusto.
          </StatePanel>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[1fr_22rem]">
            <ul className="space-y-3">
              {groups.map((group) => (
                <CartLine
                  key={group.signature}
                  group={group}
                  index={index}
                  onQuantity={(q) => (q < 1 ? remove(group) : cart.setGroupQuantity(group.signature, q))}
                  onEdit={(opener) => sheet.open(group.productId, { editGroup: group, opener })}
                  onRemove={() => remove(group)}
                />
              ))}
            </ul>
            <CartSummary subtotal={cart.subtotal} count={cart.count} canContinue={ordersOpen} closed={!ordersOpen} />
          </div>
        )}
      </div>
    </div>
  );
}
