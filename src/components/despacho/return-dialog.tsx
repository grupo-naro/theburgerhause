"use client";

import { useId, useRef, useState } from "react";
import { MAX_REASON_LENGTH, MIN_REASON_LENGTH, applyQuickReason } from "@/lib/caja/reasons";
import { RETURN_QUICK_REASONS, isReturnReasonValid } from "@/lib/despacho/reasons";
import { ModalDialog } from "./modal-dialog";

type Props = {
  orderNumber: number;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

/** Why the cadet could not deliver: quick reasons plus free text; the order goes back to dispatch. */
export function ReturnDialog({ orderNumber, busy, error, onCancel, onConfirm }: Props) {
  const titleId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const valid = isReturnReasonValid(reason);
  return (
    <ModalDialog titleId={titleId} testId="return-dialog" busy={busy} onCancel={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !busy) onConfirm(reason.trim());
        }}
        className="space-y-4 p-6"
      >
        <div>
          <h2 id={titleId} className="font-display text-2xl font-extrabold">
            No se pudo entregar el #{orderNumber}
          </h2>
          <p className="mt-1 text-ink-muted">El pedido vuelve a Listos para despachar y el cadete queda libre de él.</p>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">Motivos frecuentes</legend>
          <div className="flex flex-wrap gap-2">
            {RETURN_QUICK_REASONS.map((q) => (
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
            Motivo
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
            Cancelar
          </button>
          <button
            type="submit"
            data-testid="return-confirm"
            disabled={!valid || busy}
            className="min-h-14 rounded-full bg-state-error px-6 font-display text-lg font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Volver a despacho"}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
