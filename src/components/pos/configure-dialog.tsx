"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CloseIcon } from "@/components/menu/icons";
import { useMenuIndex } from "@/components/menu/menu-provider";
import { UnitFields } from "@/components/product/unit-fields";
import { UnitSection } from "@/components/product/unit-section";
import { formatARS } from "@/domain/money";
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
import type { CartGroup, UnitConfig } from "@/lib/cart/types";
import type { PublicProduct } from "@/lib/menu/public";
import { PosStepper } from "./pos-stepper";

export type ConfigureRequest = { productId: number; editGroup?: CartGroup };
type Props = {
  request: ConfigureRequest;
  /** Receives one config per unit; the board decides add vs replace. */
  onConfirm: (productId: number, units: UnitConfig[]) => void;
  onClose: () => void;
};

/**
 * Compact per-unit configurator of the POS: a native modal <dialog> (focus trap + Esc for free) that
 * reuses the pure sheet state and the modifier UI pieces of the storefront, with NO coupling to the
 * customer cart: it only reports `onConfirm(units)` / `onClose()`.
 */
export function ConfigureDialog({ request, onConfirm, onClose }: Props) {
  const index = useMenuIndex();
  const product = index.products.get(request.productId);
  if (!product) return <Missing onClose={onClose} />;
  return <Body product={product} editGroup={request.editGroup} onConfirm={onConfirm} onClose={onClose} />;
}

function Missing({ onClose }: { onClose: () => void }) {
  useEffect(onClose, [onClose]);
  return null;
}

function Body({
  product,
  editGroup,
  onConfirm,
  onClose,
}: {
  product: PublicProduct;
  editGroup?: CartGroup;
  onConfirm: Props["onConfirm"];
  onClose: () => void;
}) {
  const index = useMenuIndex();
  const [state, setState] = useState<SheetState>(() => initSheet(product, { editGroup }));
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pointerDownOnBackdrop = useRef(false);
  const uid = useId();
  const titleId = `${uid}-title`;
  const update = (fn: (s: SheetState) => SheetState) => setState(fn);
  const quantity = state.units.length;
  const total = sheetTotal(state, product);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = previous;
    };
  }, []);

  const confirm = () => onConfirm(product.id, toUnitConfigs(state));

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-testid="configure-dialog"
      onClose={onClose}
      onKeyDown={(e) => {
        // Ctrl+Enter confirms the dialog (it must never reach the ticket's "Cobrar").
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.stopPropagation();
          confirm();
        }
      }}
      onPointerDown={(e) => {
        pointerDownOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pointerDownOnBackdrop.current) onClose();
      }}
      className="fixed inset-0 m-auto h-fit max-h-[92dvh] w-[min(42rem,calc(100vw-1.5rem))] max-w-none animate-sheet-in overflow-clip rounded-3xl border-0 bg-surface p-0 text-ink backdrop:bg-ink/55 open:block"
    >
      <div className="flex max-h-[92dvh] flex-col">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-2xl leading-tight font-extrabold">
              {state.mode === "edit" ? "Editar" : "Personalizar"} {product.name}
            </h2>
            <p className="font-display text-lg font-extrabold text-brand-600">{formatARS(product.price)} c/u</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid size-12 shrink-0 place-items-center rounded-full ring-1 ring-line hover:bg-brand-50"
          >
            <CloseIcon className="size-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-bg px-4 py-1.5">
            <span className="font-display text-base font-bold">Cantidad</span>
            <PosStepper
              value={quantity}
              onChange={(n) => update((s) => setQuantity(s, n))}
              label="cantidad"
              testId="configure-quantity"
            />
          </div>
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
        <footer className="shrink-0 border-t border-line bg-surface px-5 py-3">
          <button
            type="button"
            onClick={confirm}
            data-testid="configure-confirm"
            className="flex min-h-14 w-full items-center justify-center rounded-full bg-cheddar-400 px-6 font-display text-lg font-extrabold text-ink shadow-sm transition-colors hover:bg-cheddar-600 active:bg-cheddar-600"
          >
            {state.mode === "edit" ? "Guardar cambios" : "Agregar al ticket"} · {formatARS(total)}
          </button>
          <p className="mt-1.5 text-center text-sm text-ink-muted">
            <kbd className="rounded border border-line bg-bg px-1.5 font-mono">Ctrl</kbd>+
            <kbd className="rounded border border-line bg-bg px-1.5 font-mono">Enter</kbd> confirma ·{" "}
            <kbd className="rounded border border-line bg-bg px-1.5 font-mono">Esc</kbd> cierra
          </p>
        </footer>
      </div>
    </dialog>
  );
}
