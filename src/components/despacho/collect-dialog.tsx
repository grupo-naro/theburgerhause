"use client";

import { useId, useState } from "react";
import { formatARS } from "@/domain/money";
import { ModalDialog } from "./modal-dialog";

type Props = {
  orderNumber: number;
  total: number;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Takeaway cash order: the cashier must charge before handing it over (and says so with a tick). */
export function CollectDialog({ orderNumber, total, busy, error, onCancel, onConfirm }: Props) {
  const titleId = useId();
  const [collected, setCollected] = useState(false);
  const amount = formatARS(total);
  return (
    <ModalDialog titleId={titleId} testId="collect-dialog" busy={busy} onCancel={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (collected && !busy) onConfirm();
        }}
        className="space-y-5 p-6"
      >
        <div>
          <h2 id={titleId} className="font-display text-2xl font-extrabold">
            Cobrá {amount} antes de entregar
          </h2>
          <p className="mt-1 text-lg text-ink-muted">Pedido #{orderNumber} · Efectivo, todavía sin cobrar.</p>
        </div>
        <label
          className={`flex min-h-16 cursor-pointer items-center gap-4 rounded-xl border-2 px-4 py-3 text-lg font-bold ${
            collected ? "border-green-600 bg-green-50" : "border-cheddar-600 bg-cheddar-400/15"
          }`}
        >
          <input
            type="checkbox"
            checked={collected}
            disabled={busy}
            onChange={(e) => setCollected(e.target.checked)}
            className="size-7 shrink-0 accent-green-700"
            autoFocus
          />
          <span>
            Cobré <span className="tabular-nums">{amount}</span>
          </span>
        </label>
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
            data-testid="collect-confirm"
            disabled={!collected || busy}
            className="min-h-14 rounded-full bg-green-700 px-6 font-display text-lg font-bold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            {busy ? "Entregando…" : "Entregar pedido"}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
