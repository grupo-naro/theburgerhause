"use client";

import { useId, useRef, useState } from "react";
import { cancelOrderAction } from "@/app/(staff)/despacho/actions";
import { MAX_REASON_LENGTH, MIN_REASON_LENGTH, applyQuickReason } from "@/lib/caja/reasons";
import { CANCEL_QUICK_REASONS, isReturnReasonValid } from "@/lib/despacho/reasons";
import type { DispatchOrder } from "@/lib/orders/dispatch-queries";
import { BigButton } from "./card-parts";
import { ModalDialog } from "./modal-dialog";
import { useCardAction } from "./use-card-action";

type DialogProps = {
  orderNumber: number;
  paid: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

/** Confirm cancelling an already approved order: a reason is mandatory (quick chips + free text). */
export function CancelDialog({ orderNumber, paid, busy, error, onCancel, onConfirm }: DialogProps) {
  const titleId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const valid = isReturnReasonValid(reason);
  return (
    <ModalDialog titleId={titleId} testId="cancel-dialog" busy={busy} onCancel={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !busy) onConfirm(reason.trim());
        }}
        className="space-y-4 p-6"
      >
        <div>
          <h2 id={titleId} className="font-display text-2xl font-extrabold">
            ¿Cancelar el pedido #{orderNumber}?
          </h2>
          <p className="mt-1 text-ink-muted">
            El pedido se anula y sale del tablero. No se puede deshacer.
            {paid ? " Ya figura como cobrado: el reintegro se resuelve aparte." : ""}
          </p>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">Motivos frecuentes</legend>
          <div className="flex flex-wrap gap-2">
            {CANCEL_QUICK_REASONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={busy}
                aria-pressed={reason === q}
                onClick={() => {
                  setReason((r) => applyQuickReason(r, q));
                  textRef.current?.focus();
                }}
                className={`min-h-12 rounded-full border px-4 text-base font-semibold disabled:opacity-60 ${
                  reason === q ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface hover:bg-brand-50"
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor={`${titleId}-reason`} className="text-sm font-bold">
            Motivo (obligatorio)
          </label>
          <textarea
            id={`${titleId}-reason`}
            ref={textRef}
            rows={3}
            value={reason}
            maxLength={MAX_REASON_LENGTH}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 block w-full resize-none rounded-xl border border-line bg-surface px-4 py-3 text-base focus-visible:outline-2 focus-visible:outline-brand-600"
          />
          <p className="mt-1 text-sm text-ink-muted">Mínimo {MIN_REASON_LENGTH} caracteres.</p>
        </div>
        {error && (
          <p role="alert" className="rounded-xl border border-state-error bg-red-50 px-4 py-2 text-sm font-medium text-state-error">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-14 rounded-full border-2 border-line bg-surface px-6 font-display text-lg font-bold hover:bg-brand-50 disabled:opacity-60"
          >
            Volver
          </button>
          <button
            type="submit"
            data-testid="cancel-confirm"
            disabled={!valid || busy}
            className="min-h-14 rounded-full bg-state-error px-6 font-display text-lg font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Cancelando…" : "Cancelar pedido"}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}

/**
 * "Cancelar pedido" button + confirm dialog for a card of the board (order approved, not yet out on
 * the street). Owns its own guarded action; the SSE event removes the card when it commits.
 */
export function CancelOrderControl({ order, disabled = false }: { order: DispatchOrder; disabled?: boolean }) {
  const { exec, busy, error, clearError } = useCardAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <BigButton
        tone="danger"
        data-testid="cancel-order"
        disabled={disabled || busy}
        aria-label={`Cancelar el pedido #${order.number}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          clearError();
          setOpen(true);
        }}
        className="mt-2 w-full !text-base"
      >
        Cancelar pedido
      </BigButton>
      {open && (
        <CancelDialog
          orderNumber={order.number}
          paid={order.paymentStatus === "paid"}
          busy={busy}
          error={error}
          onCancel={() => setOpen(false)}
          onConfirm={(reason) => exec(() => cancelOrderAction({ orderId: order.id, reason }), () => setOpen(false))}
        />
      )}
    </>
  );
}
