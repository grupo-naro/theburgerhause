"use client";

import { useEffect, useId, useRef, useState } from "react";
import { checkOrdersOpen } from "@/app/(public)/actions";
import { useCart } from "@/components/cart/cart-provider";
import { CloseIcon } from "@/components/menu/icons";
import { useMenuIndex } from "@/components/menu/menu-provider";
import { useOrdersOpen } from "@/components/menu/store-status";
import { QuantityStepper } from "@/components/ui/quantity-stepper";
import { useToast } from "@/components/ui/toast";
import type { PublicProduct } from "@/lib/menu/public";
import {
  canCopyFromFirst,
  copyFromFirst,
  initSheet,
  setExpanded,
  setNote,
  setQuantity,
  sheetTotal,
  toggleModifier,
  toUnitConfigs,
  unitSummary,
  type SheetState,
} from "@/lib/cart/sheet-state";
import type { CartGroup } from "@/lib/cart/types";
import { SheetFooter } from "./sheet-footer";
import { SheetHeader } from "./sheet-header";
import { UnitFields } from "./unit-fields";
import { UnitSection } from "./unit-section";

type Props = { request: { productId: number; editGroup?: CartGroup }; onClose: () => void };

/**
 * The product sheet: a native modal <dialog> (focus trap, Esc, inert page behind for free).
 * Bottom sheet below `md`, centered modal from `md`. All the logic lives in lib/cart/sheet-state.
 */
export function ProductSheet({ request, onClose }: Props) {
  const index = useMenuIndex();
  const product = index.products.get(request.productId);
  if (!product) return <MissingProduct onClose={onClose} />;
  return <SheetBody product={product} editGroup={request.editGroup} onClose={onClose} />;
}

/** The product vanished from the menu (deactivated while the page was open): close right away. */
function MissingProduct({ onClose }: { onClose: () => void }) {
  useEffect(onClose, [onClose]);
  return null;
}

function SheetBody({
  product,
  editGroup,
  onClose,
}: {
  product: PublicProduct;
  editGroup?: CartGroup;
  onClose: () => void;
}) {
  const index = useMenuIndex();
  const cart = useCart();
  const toast = useToast();
  const optimisticOpen = useOrdersOpen();
  const [state, setState] = useState<SheetState>(() => initSheet(product, { editGroup }));
  const [serverOpen, setServerOpen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const pointerDownOnBackdrop = useRef(false);
  const uid = useId();
  const titleId = `${uid}-title`;

  // Open as a modal, lock the page scroll, and leave cleanly.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = previousOverflow; // unmounting removes the dialog (and its top layer)
    };
  }, []);

  // The real guard: ask the server when the sheet opens (the client flag is optimistic UI only).
  useEffect(() => {
    let cancelled = false;
    checkOrdersOpen()
      .then((r) => {
        if (!cancelled) setServerOpen(r.open);
      })
      .catch(() => {
        // Could not verify now: stay optimistic here, the check runs again right before adding.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const closed = !optimisticOpen || serverOpen === false;
  const total = sheetTotal(state, product);
  const quantity = state.units.length;
  const update = (fn: (s: SheetState) => SheetState) => setState(fn);

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      let open: boolean;
      try {
        open = (await checkOrdersOpen()).open;
      } catch {
        setMessage("No pudimos verificar si estamos tomando pedidos. Probá de nuevo en un momento.");
        return;
      }
      setServerOpen(open);
      if (!open) return;
      const units = toUnitConfigs(state);
      if (state.mode === "edit" && state.editSignature) {
        cart.replaceGroup(state.editSignature, product.id, units);
      } else if (!cart.add(product.id, units)) {
        setMessage("Tu pedido llegó al máximo de unidades. Revisalo antes de seguir agregando.");
        return;
      }
      toast.show({
        message: state.mode === "edit" ? "Pedido actualizado" : "Agregado al pedido",
        action: { label: "Ver pedido", href: "/carrito" },
      });
      onClose();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-testid="product-sheet"
      onClose={onClose}
      onPointerDown={(e) => {
        pointerDownOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Backdrop click = a click that started AND ended on the <dialog> itself (it has no padding).
        if (e.target === e.currentTarget && pointerDownOnBackdrop.current) onClose();
      }}
      className="fixed inset-x-0 bottom-0 top-auto m-0 w-full max-w-none animate-sheet-in overflow-clip rounded-t-3xl border-0 bg-surface p-0 text-ink backdrop:bg-ink/55 open:block md:inset-0 md:m-auto md:h-fit md:max-w-lg md:rounded-3xl"
    >
      <div className="relative flex max-h-[92dvh] flex-col md:max-h-[88dvh]">
        <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="absolute right-3 top-3 z-10 grid size-11 place-items-center rounded-full bg-surface/95 text-ink shadow-md ring-1 ring-line transition-colors hover:bg-brand-50"
          >
            <CloseIcon className="size-5" />
          </button>
          <SheetHeader product={product} titleId={titleId} />
          <div className="px-4 pb-5">
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-bg px-4 py-2">
              <span className="font-display text-base font-bold">Cantidad</span>
              <QuantityStepper
                value={quantity}
                onChange={(n) => update((s) => setQuantity(s, n))}
                label={`Cantidad de ${product.name}`}
                testId="sheet-quantity"
              />
            </div>
            <div className="mt-4">
              {quantity > 1 ? (
                <div className="flex flex-col gap-3">
                  {state.units.map((unit, i) => (
                    <UnitSection
                      key={i}
                      product={product}
                      unit={unit}
                      index={i}
                      summary={unitSummary(state, i, index)}
                      open={state.expanded === i}
                      idPrefix={`${uid}-u${i}`}
                      canCopy={canCopyFromFirst(state, i)}
                      onOpen={() => update((s) => setExpanded(s, i))}
                      onToggle={(m) => update((s) => toggleModifier(s, i, m.id, index))}
                      onNote={(note) => update((s) => setNote(s, i, note))}
                      onCopyFirst={() => update((s) => copyFromFirst(s, i))}
                    />
                  ))}
                </div>
              ) : (
                <UnitFields
                  product={product}
                  selectedIds={state.units[0].modifierIds}
                  note={state.units[0].note}
                  idPrefix={`${uid}-u0`}
                  onToggle={(m) => update((s) => toggleModifier(s, 0, m.id, index))}
                  onNote={(note) => update((s) => setNote(s, 0, note))}
                />
              )}
            </div>
          </div>
        </div>
        <SheetFooter total={total} mode={state.mode} closed={closed} busy={busy} message={message} onSubmit={submit} />
      </div>
    </dialog>
  );
}
