"use client";

import { useId, useState } from "react";
import { formatQuantity } from "@/lib/stock/quantity";
import type { Shortage } from "@/lib/stock/queries";

const REASON_LABEL = { agotado: "Agotado", bajo_minimo: "Bajo mínimo" } as const;

const since = (d: Date) =>
  new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(d);

/**
 * Strip "Productos faltantes de stock (N)": hidden when nothing is short; a tap opens the detail (item, balance,
 * since when, reason). It holds no connection: the shell's `LiveRefresh` re-renders the page on the `stock` event.
 */
export function StockAlert({ initial }: { initial: Shortage[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (initial.length === 0) return null;
  return (
    <section data-testid="stock-alert" className="mb-4 rounded-2xl border border-state-error/40 bg-state-error/10">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left font-display text-base font-bold text-ink"
      >
        <span>Productos faltantes de stock ({initial.length})</span>
        <span aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ul id={listId} className="flex flex-col divide-y divide-line border-t border-line">
          {initial.map((s) => (
            <li key={s.itemId} data-testid="stock-alert-item" className="flex flex-col gap-0.5 px-4 py-2">
              <span className="font-medium [overflow-wrap:anywhere]">{s.name}</span>
              <span className="text-sm text-ink-muted">
                {REASON_LABEL[s.reason]} · Quedan {formatQuantity(s.quantity, s.unit)}
                {s.since !== null && ` · Desde ${since(s.since)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
