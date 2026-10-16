"use client";

import { useId } from "react";
import { ModalDialog } from "@/components/despacho/modal-dialog";
import { pluralOrders } from "@/lib/rendicion/receipt";
import { formatMoney } from "@/lib/rendicion/shortage";

type Props = {
  cadetName: string;
  orderCount: number;
  expected: number;
  received: number;
  note: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

function Figure({ label, value, tone, testId }: { label: string; value: string; tone?: "danger"; testId: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-lg font-semibold text-ink-muted">{label}</dt>
      <dd data-testid={testId} className={`font-display text-4xl leading-none font-extrabold tabular-nums ${tone === "danger" ? "text-state-error" : "text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}

/** The last stop before the money moves: repeats cadet, orders and every figure in large type. */
export function ConfirmDialog({ cadetName, orderCount, expected, received, note, busy, error, onCancel, onConfirm }: Props) {
  const titleId = useId();
  const shortage = expected - received;
  return (
    <ModalDialog titleId={titleId} testId="confirm-dialog" busy={busy} onCancel={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onConfirm();
        }}
        className="space-y-4 p-6"
      >
        <div>
          <h2 id={titleId} className="font-display text-2xl font-extrabold">
            Confirmá la rendición
          </h2>
          <p data-testid="confirm-summary" className="mt-1 text-lg font-semibold">
            Cadete {cadetName} · {pluralOrders(orderCount)}
          </p>
        </div>
        <dl className="divide-y divide-line rounded-xl border-2 border-ink px-4">
          <Figure label="Debe" value={formatMoney(expected)} testId="confirm-expected" />
          <Figure label="Recibido" value={formatMoney(received)} testId="confirm-received" />
          {shortage > 0 && <Figure label="Faltante" value={formatMoney(shortage)} tone="danger" testId="confirm-shortage" />}
        </dl>
        {note.trim() !== "" && (
          <p data-testid="confirm-note" className="rounded-xl bg-brand-50 px-4 py-3 text-base">
            <span className="font-bold">Nota: </span>
            {note.trim()}
          </p>
        )}
        <p className="text-base text-ink-muted">Al confirmar, el saldo del cadete queda en $0. No se puede deshacer.</p>
        {error && (
          <p role="alert" data-testid="confirm-error" className="rounded-xl border border-state-error bg-red-50 px-4 py-2 text-base font-medium text-state-error">
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            data-testid="confirm-cancel"
            disabled={busy}
            onClick={onCancel}
            className="min-h-14 rounded-full border-2 border-line bg-surface px-6 font-display text-lg font-bold hover:bg-brand-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            data-testid="confirm-yes"
            disabled={busy}
            className="min-h-14 rounded-full bg-green-700 px-6 font-display text-lg font-bold text-white hover:bg-green-800 disabled:cursor-wait disabled:opacity-70"
          >
            {busy ? "Guardando…" : "Sí, confirmar"}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
