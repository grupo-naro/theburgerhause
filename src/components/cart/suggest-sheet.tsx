"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";
import { CloseIcon, PlusIcon } from "@/components/menu/icons";
import { ProductImage } from "@/components/menu/product-image";
import { useProductSheet } from "@/components/product/sheet-context";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { formatARS } from "@/domain/money";
import { markSuggestionsSeen } from "@/lib/cart/suggest-seen";
import type { PublicProduct } from "@/lib/menu/public";
import { useCart } from "./cart-provider";

type Props = { products: PublicProduct[]; onClose: () => void };

/**
 * "Antes de seguir…": optional add-ons offered when the customer taps Continuar. A native modal
 * <dialog> like the product sheet (focus trap, Esc, inert page behind): bottom sheet below `md`,
 * centered from `md`. Adding is immediate; only "Seguir con mi pedido" goes to checkout.
 */
export function SuggestSheet({ products, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pointerDownOnBackdrop = useRef(false);
  const uid = useId();
  const titleId = `${uid}-title`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-testid="suggest-sheet"
      onClose={onClose}
      onPointerDown={(e) => {
        pointerDownOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pointerDownOnBackdrop.current) onClose();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none animate-sheet-in overflow-clip rounded-t-3xl border-0 bg-surface p-0 text-ink backdrop:bg-ink/55 open:block md:inset-0 md:m-auto md:h-fit md:max-w-lg md:rounded-3xl"
    >
      <div className="relative flex max-h-[92dvh] flex-col md:max-h-[88dvh]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-3 top-3 z-10 grid size-11 place-items-center rounded-full bg-surface/95 text-ink shadow-md ring-1 ring-line transition-colors hover:bg-brand-50"
        >
          <CloseIcon className="size-5" />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-5">
          <h2 id={titleId} className="pr-12 font-display text-2xl font-extrabold text-ink">
            Antes de seguir…
          </h2>
          <p className="mt-1 text-base text-ink-muted">Sumá algo a tu pedido</p>
          <ul className="-mx-4 mt-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
            {products.map((product) => (
              <SuggestCard key={product.id} product={product} onOpenOptions={onClose} />
            ))}
          </ul>
        </div>
        <div className="border-t border-line bg-surface p-4">
          <Link
            href="/checkout"
            data-testid="suggest-continue"
            onClick={() => {
              markSuggestionsSeen();
              onClose(); // Next keeps the cart page mounted behind checkout: Back must not find the sheet open
            }}
            className="flex min-h-14 w-full items-center justify-center rounded-full bg-cheddar-400 px-6 text-center font-display text-lg font-extrabold text-ink shadow-sm transition-colors hover:bg-cheddar-600"
          >
            Seguir con mi pedido
          </Link>
        </div>
      </div>
    </dialog>
  );
}

function SuggestCard({ product, onOpenOptions }: { product: PublicProduct; onOpenOptions: () => void }) {
  const cart = useCart();
  const sheet = useProductSheet();
  const groups = cart.groups.filter((g) => g.productId === product.id);
  const quantity = groups.reduce((n, g) => n + g.quantity, 0);
  const hasOptions = product.modifierGroups.length > 0;

  function add(opener: Element) {
    if (hasOptions) {
      // The customer picks options in the product sheet; the suggestion sheet gets out of the way.
      onOpenOptions();
      sheet.open(product.id, { opener });
      return;
    }
    cart.add(product.id, [{ modifierIds: [], note: "" }]);
  }

  return (
    <li
      data-testid="suggest-card"
      data-product-id={product.id}
      className="flex w-40 shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-sm"
    >
      <span className="block aspect-[4/3] w-full overflow-hidden bg-brand-50">
        <ProductImage product={product} sizes="160px" />
      </span>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <span className="line-clamp-2 font-display text-base font-bold leading-tight [overflow-wrap:anywhere]">
          {product.name}
        </span>
        <span className="font-display text-lg font-extrabold text-brand-600">{formatARS(product.price)}</span>
        <div className="mt-auto flex justify-end pt-2">
          {quantity > 0 && !hasOptions ? (
            <QuantityStepper
              value={quantity}
              min={0}
              label={`Cantidad de ${product.name}`}
              decrementLabel={quantity === 1 ? "Quitar" : "Disminuir cantidad"}
              onChange={(n) => groups[0] && cart.setGroupQuantity(groups[0].signature, n)}
            />
          ) : (
            <button
              type="button"
              data-testid="suggest-add"
              aria-label={`Agregar ${product.name}`}
              onClick={(e) => add(e.currentTarget)}
              className="grid size-11 place-items-center rounded-full bg-cheddar-400 text-ink shadow-sm transition-colors hover:bg-cheddar-600"
            >
              <PlusIcon className="size-5" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
