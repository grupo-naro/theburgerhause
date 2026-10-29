"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { addAddonAction, editPendingOrderAction } from "@/app/(staff)/editar-pedido/actions";
import { CartProvider, useCart } from "@/components/cart/cart-provider";
import { useGuardedAction } from "@/components/caja/use-guarded-action";
import { ModalDialog } from "@/components/despacho/modal-dialog";
import { useMenuIndex } from "@/components/menu/menu-provider";
import { CatalogPanel } from "@/components/pos/catalog-panel";
import { ConfigureDialog, type ConfigureRequest } from "@/components/pos/configure-dialog";
import { formatARS } from "@/domain/money";
import { toOrderUnits } from "@/lib/cart/order-input";
import { lineTotalFor } from "@/lib/cart/pricing";
import type { UnitConfig } from "@/lib/cart/types";
import type { PublicProduct } from "@/lib/menu/public";
import { createKeyHolder } from "@/lib/checkout/idempotency";
import { addonPaymentCopy, addonSubmissionSignature, editedTotal, totalWithAddon, unitsAfterEdit, type EditorItem } from "@/lib/orders/editor-math";
import { PLAIN_UNIT, ticketTotals } from "@/lib/pos/fast-path";

export type { EditorItem } from "@/lib/orders/editor-math";

type Props = {
  mode: "edit" | "add";
  orderId: number;
  items: EditorItem[];
  open: boolean;
  onClose: () => void;
  /** Order context for the totals and the payment copy. */
  channel?: "web" | "counter";
  paymentMethod?: "cash" | "transfer";
  /** Centavos; an edit never recalculates it. */
  deliveryFee?: number;
  /** Add mode: the order's current total (centavos), to show "Total del pedido" when the add-on applies at once. */
  orderTotal?: number;
};

/**
 * Memory-only draft (no localStorage key): it never mixes with the POS ticket or the storefront cart and is never
 * synced across tabs, so a draft started for one order cannot leak into another tab's dialog (or another order).
 */
const EDITOR_CART_KEY = null;
const MAX_MESSAGE = "Llegaste al máximo de unidades.";
const NO_PULSES: Record<number, number> = {};

const secondary =
  "min-h-12 rounded-full border-2 border-line bg-surface px-5 font-display text-base font-bold text-ink hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Staff dialog to change an order. `edit` (order waiting for approval): reversible "Quitar" on each unit
 * plus new products, with the new total shown before saving. `add` (order in preparation): new products
 * only, sent as an add-on with the payment instruction. The picker is the POS one.
 */
export function OrderEditorDialog(props: Props) {
  if (!props.open) return null;
  return <EditorShell {...props} />;
}

function EditorShell(props: Props) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  return (
    <ModalDialog titleId={titleId} testId="order-editor" busy={busy} onCancel={props.onClose}>
      <CartProvider storageKey={EDITOR_CART_KEY}>
        <EditorBody {...props} titleId={titleId} onBusy={setBusy} />
      </CartProvider>
    </ModalDialog>
  );
}

function EditorBody({
  mode,
  orderId,
  items,
  onClose,
  channel = "web",
  paymentMethod = "cash",
  deliveryFee = 0,
  orderTotal,
  titleId,
  onBusy,
}: Props & { titleId: string; onBusy: (busy: boolean) => void }) {
  const router = useRouter();
  const cart = useCart();
  const index = useMenuIndex();
  const { run, pending, error, clearError } = useGuardedAction();
  const searchRef = useRef<HTMLInputElement>(null);
  /**
   * Add-on idempotency key, in memory for this opening: an identical retry after a lost answer reuses it (the server
   * replays the same add-on); a changed draft gets a new one, so its new lines are never dropped by a replay.
   */
  const keyHolder = useRef<ReturnType<typeof createKeyHolder> | null>(null);
  const [removed, setRemoved] = useState<ReadonlySet<number>>(new Set());
  const [configure, setConfigure] = useState<ConfigureRequest | null>(null);
  const [soldOut, setSoldOut] = useState<ReadonlySet<number>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  // Every opening starts from an empty draft: the cart is memory-only and mounted with the dialog.
  const { ready } = cart;
  useEffect(() => onBusy(pending), [pending, onBusy]);

  const added = ticketTotals(cart.lines, index).subtotal;
  const isEdit = mode === "edit";
  const total = editedTotal({ items, removedIds: removed, addedSubtotal: added, deliveryFee });
  const orderTotalAfter = orderTotal === undefined ? null : totalWithAddon({ channel, paymentMethod, orderTotal, added });
  const leftUnits = unitsAfterEdit(items, removed, cart.count);
  const changed = isEdit ? removed.size > 0 || cart.count > 0 : cart.count > 0;
  const empty = isEdit && leftUnits < 1;
  const canSave = changed && !empty && !pending && ready;

  function toggleRemoved(id: number) {
    setNotice(null);
    setRemoved((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function addUnits(productId: number, units: UnitConfig[]): boolean {
    setNotice(null);
    clearError();
    const ok = cart.add(productId, units);
    if (!ok) setNotice(MAX_MESSAGE);
    return ok;
  }

  function submit() {
    if (!canSave) return;
    const units = toOrderUnits(cart.lines);
    const handlers = {
      onOk: () => {
        cart.clear();
        onClose();
        router.refresh();
      },
      onFail: (f: { code: string }) => {
        // OUT_OF_STOCK also carries the products: their tiles show "Sin stock" and cannot be added again.
        if (f.code === "OUT_OF_STOCK" && "productIds" in f && Array.isArray(f.productIds)) {
          const ids = f.productIds as number[];
          setSoldOut((prev) => new Set([...prev, ...ids]));
        }
      },
    };
    if (isEdit) run(() => editPendingOrderAction({ orderId, removeItemIds: [...removed], addUnits: units }), handlers);
    else {
      keyHolder.current ??= createKeyHolder(null);
      const idempotencyKey = keyHolder.current.get(addonSubmissionSignature(orderId, units));
      run(() => addAddonAction({ orderId, units, idempotencyKey }), handlers);
    }
  }

  return (
    <div className="max-h-[calc(100dvh-2rem)] overflow-y-auto" data-mode={mode}>
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-display text-2xl font-extrabold">
            {isEdit ? "Editar pedido" : "Agregar productos"}
          </h2>
          <button type="button" data-testid="editor-close" disabled={pending} onClick={onClose} className={secondary}>
            Cerrar
          </button>
        </div>

        {items.length > 0 && (
          <section aria-label="Productos del pedido">
            <ul className="divide-y divide-line rounded-xl border border-line">
              {items.map((it) => {
                const gone = removed.has(it.id);
                return (
                  <li
                    key={it.id}
                    data-testid="editor-item"
                    data-removed={gone ? "true" : undefined}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <p className={`min-w-0 text-base ${gone ? "text-ink-muted line-through" : "font-semibold text-ink"}`}>
                      {it.addonSeq !== null && (
                        <span className="mr-1.5 rounded bg-ink px-1.5 text-xs font-extrabold text-white uppercase">Adicional {it.addonSeq}</span>
                      )}
                      {it.label}
                    </p>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`tabular-nums ${gone ? "text-ink-muted line-through" : "font-semibold"}`}>{formatARS(it.total)}</span>
                      {isEdit && (
                        <button
                          type="button"
                          data-testid="editor-remove"
                          aria-pressed={gone}
                          disabled={pending}
                          onClick={() => toggleRemoved(it.id)}
                          className={`${secondary} !min-h-11 !px-4 !text-sm`}
                        >
                          {gone ? "Deshacer" : "Quitar"}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section aria-label="Productos a agregar" className="space-y-2">
          <h3 className="font-display text-lg font-extrabold">Agregar</h3>
          {cart.groups.length > 0 && (
            <ul data-testid="editor-new-lines" className="divide-y divide-line rounded-xl border border-green-300 bg-green-50">
              {cart.groups.map((g) => (
                <li key={g.signature} className="flex items-center justify-between gap-3 px-3 py-2">
                  <p className="min-w-0 text-base font-semibold">
                    {g.quantity}× {index.products.get(g.productId)?.name ?? "Producto"}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-semibold tabular-nums">{formatARS(lineTotalFor(g, index))}</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => cart.removeGroup(g.signature)}
                      className={`${secondary} !min-h-11 !px-4 !text-sm`}
                    >
                      Sacar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <CatalogPanel
            searchRef={searchRef}
            pulses={NO_PULSES}
            soldOut={soldOut}
            onAdd={(p: PublicProduct) => {
              if (!soldOut.has(p.id)) addUnits(p.id, [PLAIN_UNIT]);
            }}
            onCustomize={(p) => {
              if (!soldOut.has(p.id)) setConfigure({ productId: p.id });
            }}
          />
        </section>

        <div className="space-y-2 border-t border-line pt-3">
          {isEdit ? (
            <p className="flex items-baseline justify-between gap-3">
              <span className="font-display text-xl font-bold">Total nuevo</span>
              <span data-testid="editor-total" className="font-display text-3xl font-extrabold tabular-nums">
                {formatARS(total)}
              </span>
            </p>
          ) : (
            <>
              <p className="flex items-baseline justify-between gap-3">
                <span className="font-display text-xl font-bold">Adicional</span>
                <span data-testid="editor-total" className="font-display text-3xl font-extrabold tabular-nums">
                  {formatARS(added)}
                </span>
              </p>
              {cart.count > 0 && orderTotalAfter !== null && (
                <p className="flex items-baseline justify-between gap-3 text-ink-muted">
                  <span className="text-base font-semibold">Total del pedido</span>
                  <span data-testid="editor-order-total" className="text-xl font-bold tabular-nums">
                    {formatARS(orderTotalAfter)}
                  </span>
                </p>
              )}
              {cart.count > 0 && (
                <p data-testid="editor-payment-copy" className="rounded-xl bg-cheddar-400/25 px-3 py-2 text-base font-bold text-ink">
                  {addonPaymentCopy({ channel, paymentMethod, amount: added })}
                </p>
              )}
            </>
          )}
          {empty && <p className="text-base font-semibold text-state-error">El pedido no puede quedar sin productos. Rechazalo si no se va a hacer.</p>}
          {notice && <p className="text-base font-semibold text-state-error">{notice}</p>}
          {error && (
            <p role="alert" data-testid="editor-error" className="rounded-xl border border-state-error bg-red-50 px-4 py-2 text-base font-medium text-state-error">
              {error}
            </p>
          )}
          <button
            type="button"
            data-testid="editor-save"
            disabled={!canSave}
            onClick={submit}
            className="min-h-14 w-full rounded-full bg-green-700 px-6 font-display text-lg font-bold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            {pending ? "Guardando…" : isEdit ? "Guardar cambios" : "Agregar al pedido"}
          </button>
        </div>
      </div>

      {configure && (
        <ConfigureDialog
          key={`new-${configure.productId}`}
          request={configure}
          onConfirm={(productId, units) => {
            if (addUnits(productId, units)) setConfigure(null);
          }}
          onClose={() => setConfigure(null)}
        />
      )}
    </div>
  );
}
