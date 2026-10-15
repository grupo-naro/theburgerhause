"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MAX_REASON_LENGTH, MIN_REASON_LENGTH, QUICK_REASONS, applyQuickReason, isReasonValid } from "@/lib/caja/reasons";

type Props = {
  orderNumber: number;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

/**
 * Modal asking why an order is rejected. Native <dialog>: the browser traps focus, makes the page
 * inert, closes on Esc and returns focus to the "Rechazar" button. Mounted only while open.
 */
export function RejectDialog({ orderNumber, busy, error, onCancel, onConfirm }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const [reason, setReason] = useState("");
  const valid = isReasonValid(reason);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    textRef.current?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-testid="reject-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-[0_24px_64px_rgba(11,31,58,0.35)] backdrop:bg-ink/60"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !busy) onConfirm(reason.trim());
        }}
        className="space-y-4 p-6"
      >
        <div>
          <h2 id={titleId} className="font-display text-2xl font-extrabold text-ink">
            Rechazar pedido #{orderNumber}
          </h2>
          <p className="mt-1 text-ink-muted">El cliente va a ver el pedido como cancelado, con este motivo.</p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-bold text-ink">Motivos frecuentes</legend>
          <div className="flex flex-wrap gap-2">
            {QUICK_REASONS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={busy}
                aria-pressed={reason === q}
                onClick={() => setReason((r) => applyQuickReason(r, q))}
                className={`min-h-12 rounded-full border px-4 text-base font-semibold transition-colors disabled:opacity-60 ${
                  reason === q
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-line bg-surface text-ink hover:bg-brand-50"
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor={`${titleId}-reason`} className="text-sm font-bold text-ink">
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
            aria-describedby={`${titleId}-help`}
            className="mt-1 block w-full resize-none rounded-xl border border-line bg-surface px-4 py-3 text-base text-ink focus-visible:outline-2 focus-visible:outline-brand-600"
          />
          <p id={`${titleId}-help`} className="mt-1 text-sm text-ink-muted">
            Mínimo {MIN_REASON_LENGTH} caracteres.
          </p>
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
            className="min-h-12 rounded-full border border-line bg-surface px-6 text-lg font-bold text-ink hover:bg-brand-50 disabled:opacity-60"
          >
            Volver
          </button>
          <button
            type="submit"
            disabled={!valid || busy}
            className="min-h-12 rounded-full bg-state-error px-6 text-lg font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Rechazando…" : "Rechazar pedido"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
