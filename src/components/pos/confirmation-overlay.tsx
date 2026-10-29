"use client";

import { useEffect, useId, useRef, useState } from "react";
import { queueReprints, reprintsFor } from "@/lib/caja/reprint-queue";
import { reprintOrderAction } from "@/app/(staff)/caja/actions";
import { formatARS } from "@/domain/money";
import { AlertIcon, PrinterIcon } from "./pos-icons";
import { CheckIcon } from "@/components/menu/icons";
import type { Confirmation } from "./use-counter-sale";
import { usePrintStatus } from "./use-print-status";

type Props = { sale: Confirmation; onNewSale: () => void };

const PAYMENT_LABEL = { cash: "Efectivo", transfer: "Transferencia" } as const;

/**
 * Confirmation after a sale: big order number and pager, payment, and the print status line fed by
 * polling. "Nuevo pedido" is focused from the start: ONE Enter and the next sale begins. Esc does the
 * same, so the overlay can never trap the cashier.
 */
export function ConfirmationOverlay({ sale, onNewSale }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const newSaleRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const { status, state, restart } = usePrintStatus(sale.orderId);
  /** Reprints already queued in this attempt: a retry after a partial failure never queues the kitchen comanda twice. */
  const queued = useRef(new Set<string>());
  const [reprinting, setReprinting] = useState(false);
  const [reprintError, setReprintError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    newSaleRef.current?.focus();
  }, []);

  async function reprint() {
    if (reprinting) return;
    setReprinting(true);
    setReprintError(null);
    try {
      // Reprint exactly what failed (kitchen comanda first), or what the agent has not confirmed; never kinds that printed fine.
      const kinds = status === "failed" ? state?.failedKinds : state?.pendingKinds;
      const which = reprintsFor(kinds ?? []);
      // A failure that is only an add-on ticket has nothing to reprint from here (never fall back to the customer ticket).
      if (status === "failed" && kinds !== undefined && which.length === 0) return;
      const r = await queueReprints(which.length > 0 ? which : ["customer"], queued.current, (w) =>
        reprintOrderAction({ orderId: sale.orderId, which: w }),
      );
      if (r.ok) {
        queued.current.clear();
        restart();
      } else setReprintError("message" in r ? r.message : "No pudimos reimprimir. Probá de nuevo.");
    } catch {
      setReprintError("No pudimos reimprimir. Probá de nuevo.");
    } finally {
      setReprinting(false);
    }
  }

  // No failed kind at all (the failure is an add-on ticket) = nothing to reprint from here; an answer without kinds keeps the old behaviour.
  const addonOnlyFailure = status === "failed" && state?.failedKinds !== undefined && reprintsFor(state.failedKinds).length === 0;

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${uid}-t`}
      data-testid="confirmation-overlay"
      data-print-status={status}
      onClose={onNewSale}
      className="fixed inset-0 m-auto h-fit w-[min(30rem,calc(100vw-2rem))] animate-sheet-in overflow-clip rounded-3xl border-0 bg-surface p-0 text-ink backdrop:bg-ink/60 open:block"
    >
      <div className="bg-state-ready px-6 pt-5 pb-4 text-center text-white">
        <p className="inline-flex items-center gap-2 font-display text-2xl font-extrabold">
          <CheckIcon className="size-7" strokeWidth={3} /> Cobrado
        </p>
        <h2 id={`${uid}-t`} data-testid="confirm-order" className="font-display text-6xl leading-none font-extrabold tabular-nums">
          Pedido #{sale.number}
        </h2>
      </div>
      <div className="px-6 py-5 text-center">
        <p className="text-lg font-semibold text-ink-muted">Entregá el llamador</p>
        <p data-testid="confirm-pager" className="font-display text-7xl leading-none font-extrabold tabular-nums text-brand-600">
          Llamador {sale.pager}
        </p>
        <p className="mt-4 text-xl text-ink">
          <span data-testid="confirm-payment" className="font-semibold">
            {PAYMENT_LABEL[sale.payment]}
          </span>{" "}
          · <span data-testid="confirm-total" className="font-display text-2xl font-extrabold tabular-nums">{formatARS(sale.total)}</span>
        </p>

        <div
          role="status"
          aria-live="polite"
          data-testid="print-status"
          data-status={status}
          className={`mt-4 flex min-h-14 items-center justify-center gap-2 rounded-2xl px-4 py-2 text-lg font-bold ${
            status === "failed"
              ? "bg-red-50 text-state-error ring-1 ring-red-200"
              : status === "done"
                ? "bg-state-ready/15 text-ink"
                : "bg-bg text-ink"
          }`}
        >
          {status === "printing" && (
            <>
              <PrinterIcon className="size-6 animate-pulse" /> Imprimiendo…
            </>
          )}
          {status === "done" && (
            <>
              Impreso ✓
            </>
          )}
          {status === "waiting" && (
            <>
              <AlertIcon className="size-6 text-state-pending" /> Esperando la impresora…
            </>
          )}
          {status === "failed" && (
            <>
              <AlertIcon className="size-6" /> Falló la impresión
            </>
          )}
        </div>
        {addonOnlyFailure && (
          <p data-testid="addon-print-failed" className="mt-2 text-base font-semibold text-ink">
            Falló el ticket de un adicional: reimprimilo desde la alerta de impresión de Caja o Retiro en local.
          </p>
        )}
        {(status === "waiting" || (status === "failed" && !addonOnlyFailure)) && (
          <button
            type="button"
            data-testid="reprint"
            disabled={reprinting}
            onClick={reprint}
            className="mt-2 min-h-12 w-full rounded-full border-2 border-brand-600 bg-brand-50 font-display text-lg font-bold text-brand-700 hover:bg-brand-600 hover:text-white disabled:opacity-60"
          >
            {reprinting ? "Enviando…" : status === "failed" ? "Reimprimir" : "Reimprimir (puede salir duplicado)"}
          </button>
        )}
        {reprintError && (
          <p role="alert" className="mt-2 text-base font-semibold text-state-error">
            {reprintError}
          </p>
        )}

        <button
          ref={newSaleRef}
          type="button"
          data-testid="new-sale"
          onClick={onNewSale}
          className="mt-4 min-h-16 w-full rounded-full bg-cheddar-400 font-display text-2xl font-extrabold text-ink shadow-md ring-2 ring-cheddar-600/40 hover:bg-cheddar-600"
        >
          Nuevo pedido
        </button>
        <p className="mt-2 text-sm text-ink-muted">
          <kbd className="rounded border border-line bg-bg px-1.5 font-mono">Enter</kbd> para seguir con el próximo
        </p>
      </div>
    </dialog>
  );
}
