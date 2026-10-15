"use client";

import { useId, useState } from "react";
import { formatARS } from "@/domain/money";
import { approvalState } from "@/lib/caja/approval";

type Props = {
  orderNumber: number;
  paymentMethod: "cash" | "transfer";
  total: number;
  busy: boolean;
  onApprove: (paymentVerified: boolean) => void;
  onReject: () => void;
  /** Gives the reject button back to the card so focus can return to it after the dialog. */
  rejectRef: React.RefObject<HTMLButtonElement | null>;
};

/** Approve / reject controls of one pending card. 48 px targets, 18 px main buttons. */
export function OrderActions({ orderNumber, paymentMethod, total, busy, onApprove, onReject, rejectRef }: Props) {
  const [verified, setVerified] = useState(false);
  const hintId = useId();
  const state = approvalState({ paymentMethod, verified, busy });

  return (
    <div className="space-y-3">
      {paymentMethod === "transfer" && (
        <label
          className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-2 text-base font-semibold transition-colors ${
            verified ? "border-green-600 bg-green-50" : "border-cheddar-600 bg-cheddar-400/15"
          }`}
        >
          <input
            type="checkbox"
            checked={verified}
            disabled={busy}
            onChange={(e) => setVerified(e.target.checked)}
            className="size-6 shrink-0 accent-green-700"
          />
          <span>
            Verifiqué la acreditación del pago de <strong className="tabular-nums">{formatARS(total)}</strong>
          </span>
        </label>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          data-testid="approve"
          disabled={!state.enabled}
          aria-describedby={state.hint ? hintId : undefined}
          onClick={() => onApprove(verified)}
          className="min-h-14 flex-1 rounded-full bg-green-700 px-6 font-display text-lg font-bold text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
        >
          {state.label}
        </button>
        <button
          ref={rejectRef}
          type="button"
          data-testid="reject"
          disabled={busy}
          aria-label={`Rechazar pedido #${orderNumber}`}
          onClick={onReject}
          className="min-h-14 rounded-full border-2 border-state-error bg-surface px-6 font-display text-lg font-bold text-state-error transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Rechazar
        </button>
      </div>

      {state.hint && (
        <p id={hintId} data-testid="approve-hint" className="text-sm text-ink-muted">
          {state.hint}
        </p>
      )}
    </div>
  );
}
