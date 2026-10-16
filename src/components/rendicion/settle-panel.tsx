"use client";

import { useId, useRef, useState } from "react";
import { canConfirm, shouldCloseConfirm } from "@/lib/rendicion/confirm";
import { QUICK_NOTES, applyQuickNote } from "@/lib/rendicion/notes";
import { formatPesosInput, parsePesosToCents } from "@/lib/rendicion/parse-pesos";
import { diffLabel } from "@/lib/rendicion/shortage";
import { MAX_SETTLEMENT_NOTE } from "@/lib/settlements/schemas";
import { ConfirmDialog } from "./confirm-dialog";

type Props = {
  cadetName: string;
  /** Centavos the server will expect: the figure of the SAME render as the orders table. */
  expected: number;
  orderCount: number;
  busy: boolean;
  error: string | null;
  onSubmit: (v: { received: number; note: string }) => void;
  onCancelConfirm: () => void;
};

/** "Recibí el efectivo": amount input, live difference, shortage note and the confirmation dialog. */
export function SettlePanel({ cadetName, expected, orderCount, busy, error, onSubmit, onCancelConfirm }: Props) {
  const amountId = useId();
  const noteId = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(() => formatPesosInput(expected));
  const [note, setNote] = useState("");
  const [confirmAt, setConfirmAt] = useState<number | null>(null);

  const parsed = parsePesosToCents(text);
  const check = canConfirm({ orderCount, expected, received: parsed, note, inFlight: busy });
  const diff = parsed.ok ? diffLabel(expected, parsed.cents) : null;
  const short = diff?.kind === "short";
  // The dialog never stays open over a figure the manager no longer sees.
  const confirmOpen = confirmAt !== null && !shouldCloseConfirm(confirmAt, expected);

  const open = () => {
    if (check.ok) setConfirmAt(expected);
  };
  const cancel = () => {
    setConfirmAt(null);
    onCancelConfirm();
  };

  const form = (
    <form
      data-testid="settle-panel"
      onSubmit={(e) => {
        e.preventDefault();
        open();
      }}
      className="space-y-4 rounded-2xl border-2 border-ink bg-surface p-5"
    >
      <h3 className="font-display text-2xl font-extrabold">Recibí el efectivo</h3>

      <div>
        <label htmlFor={amountId} className="text-base font-bold">
          Efectivo recibido
        </label>
        <div className={`mt-1 flex items-center rounded-xl border-2 bg-white px-4 ${diff?.tone === "danger" ? "border-state-error" : "border-line focus-within:border-brand-600"}`}>
          <span aria-hidden className="mr-2 font-display text-3xl font-extrabold text-ink-muted">
            $
          </span>
          <input
            id={amountId}
            data-testid="received-input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            disabled={busy}
            aria-invalid={!parsed.ok || diff?.kind === "over"}
            aria-describedby={`${amountId}-diff`}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              const p = parsePesosToCents(text);
              if (p.ok) setText(formatPesosInput(p.cents));
            }}
            className="min-h-16 w-full bg-transparent py-2 font-display text-4xl font-extrabold tabular-nums outline-none"
          />
        </div>
        <p
          id={`${amountId}-diff`}
          role="status"
          data-testid="diff-line"
          data-kind={diff?.kind ?? "invalid"}
          className={`mt-2 min-h-8 text-xl font-extrabold ${diff?.tone === "ok" ? "text-green-700" : "text-state-error"}`}
        >
          {diff ? (
            <>
              <span className="font-semibold text-ink-muted">Diferencia: </span>
              {diff.text}
            </>
          ) : (
            <span className="text-base font-semibold">{check.ok ? "" : check.reason}</span>
          )}
        </p>
      </div>

      <div>
        <label htmlFor={noteId} className="text-base font-bold">
          {short ? "Nota del faltante (obligatoria)" : "Nota (opcional)"}
        </label>
        {short && (
          <div className="mt-2 flex flex-wrap gap-2" data-testid="quick-notes">
            {QUICK_NOTES.map((q) => (
              <button
                key={q.label}
                type="button"
                data-testid="quick-note"
                disabled={busy}
                onClick={() => {
                  setNote((cur) => applyQuickNote(cur, q));
                  noteRef.current?.focus();
                }}
                className="min-h-12 rounded-full border-2 border-line bg-surface px-4 text-base font-bold hover:bg-brand-50 disabled:opacity-60"
              >
                {q.label}
              </button>
            ))}
          </div>
        )}
        <textarea
          id={noteId}
          ref={noteRef}
          data-testid="note-input"
          rows={2}
          maxLength={MAX_SETTLEMENT_NOTE}
          value={note}
          disabled={busy}
          required={short}
          placeholder={short ? "¿Por qué falta plata?" : "Algo que quieras dejar anotado"}
          onChange={(e) => setNote(e.target.value)}
          className={`mt-2 w-full rounded-xl border-2 bg-white px-4 py-3 text-lg outline-none focus:border-brand-600 ${short && note.trim().length < 3 ? "border-state-error" : "border-line"}`}
        />
      </div>

      <div>
        <button
          type="submit"
          data-testid="confirm-settlement"
          disabled={!check.ok}
          className="min-h-14 w-full rounded-full bg-green-700 px-6 font-display text-xl font-bold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
        >
          Confirmar rendición
        </button>
        {!check.ok && (
          <p data-testid="confirm-reason" className="mt-2 text-center text-base font-medium text-ink-muted">
            {check.reason}
          </p>
        )}
      </div>
    </form>
  );

  return (
    <>
      {form}
      {confirmOpen && parsed.ok && (
        <ConfirmDialog
          cadetName={cadetName}
          orderCount={orderCount}
          expected={expected}
          received={parsed.cents}
          note={note}
          busy={busy}
          error={error}
          onCancel={cancel}
          onConfirm={() => onSubmit({ received: parsed.cents, note: note.trim() })}
        />
      )}
    </>
  );
}
