"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ModalDialog } from "@/components/despacho/modal-dialog";
import { buildReceipt, formatSettledAt } from "@/lib/rendicion/receipt";
import { formatMoney } from "@/lib/rendicion/shortage";
import type { SettlementRecord } from "@/lib/settlements/queries";
import { ReceiptView } from "./receipt";

function ReceiptModal({ record, onClose }: { record: SettlementRecord; onClose: () => void }) {
  const titleId = useId();
  return (
    <ModalDialog titleId={titleId} testId="receipt-modal" busy={false} onCancel={onClose}>
      <div className="p-4">
        <h2 id={titleId} className="sr-only">
          Comprobante de la rendición #{record.id}
        </h2>
        <ReceiptView receipt={buildReceipt(record)} />
        <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end print:hidden">
          <button type="button" data-testid="receipt-close" onClick={onClose} className="min-h-14 rounded-full border-2 border-line bg-surface px-6 font-display text-lg font-bold hover:bg-brand-50">
            Cerrar
          </button>
          <button
            type="button"
            data-testid="print-receipt"
            onClick={() => window.print()}
            className="min-h-14 rounded-full bg-brand-600 px-6 font-display text-lg font-bold text-white hover:bg-brand-700"
          >
            Imprimir comprobante
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}

type Props = { records: SettlementRecord[]; now: Date; cadetId: number; showingAll: boolean; hasMore: boolean };

/** Past settlements of the cadet (newest first), each with its receipt. */
export function History({ records, now, cadetId, showingAll, hasMore }: Props) {
  const [open, setOpen] = useState<SettlementRecord | null>(null);
  return (
    <section data-testid="history" aria-labelledby="history-h" className="space-y-3">
      <h3 id="history-h" className="font-display text-xl font-extrabold">
        Rendiciones anteriores
      </h3>
      {records.length === 0 ? (
        <p data-testid="history-empty" className="rounded-2xl border border-line bg-surface px-5 py-6 text-ink-muted">
          Todavía no hay rendiciones de este cadete.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {records.map((r) => (
            <li key={r.id} data-testid="history-row" data-settlement-id={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-base font-bold">
                  Rendición #{r.id} · {formatSettledAt(r.createdAt, now)}
                </p>
                <p className="text-sm text-ink-muted">
                  {r.orderCount} {r.orderCount === 1 ? "pedido" : "pedidos"} · {r.settledByName ?? "—"}
                </p>
                {r.note && <p className="text-sm break-words text-ink">“{r.note}”</p>}
              </div>
              <div className="text-right">
                <p className="text-base font-bold tabular-nums">Recibido {formatMoney(r.receivedAmount)}</p>
                {r.shortage > 0 ? (
                  <span data-testid="history-shortage" className="inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-bold text-red-800">
                    Faltó {formatMoney(r.shortage)}
                  </span>
                ) : (
                  <span className="inline-block rounded-full bg-green-100 px-2.5 py-0.5 text-sm font-bold text-green-800">Exacto</span>
                )}
              </div>
              <button
                type="button"
                data-testid="view-receipt"
                onClick={() => setOpen(r)}
                className="min-h-12 rounded-full border-2 border-brand-600 px-4 text-base font-bold text-brand-600 hover:bg-brand-50"
              >
                Ver comprobante
              </button>
            </li>
          ))}
        </ul>
      )}
      {hasMore && !showingAll && (
        <Link href={`/despacho/rendicion?cadet=${cadetId}&historial=todas`} data-testid="history-all" className="inline-flex min-h-12 items-center text-base font-bold text-brand-600 underline underline-offset-4">
          Ver todas
        </Link>
      )}
      {open && <ReceiptModal record={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
