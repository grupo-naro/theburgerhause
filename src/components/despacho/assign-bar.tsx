"use client";

import { formatARS } from "@/domain/money";
import type { AssignState } from "@/lib/despacho/assign";
import type { DispatchCadet } from "@/lib/orders/dispatch-queries";

export type AssignFailure = { message: string; lines: string[] };

type Props = {
  count: number;
  cash: number;
  cadets: DispatchCadet[];
  cadetId: number | null;
  inFlight: boolean;
  failure: AssignFailure | null;
  state: AssignState;
  onCadet: (id: number | null) => void;
  onClear: () => void;
  onAssign: () => void;
  onDismissFailure: () => void;
};

/** Sticky bottom bar of the delivery lane: appears with the first selected order. */
export function AssignBar({ count, cash, cadets, cadetId, inFlight, failure, state, onCadet, onClear, onAssign, onDismissFailure }: Props) {
  const cadet = cadets.find((c) => c.id === cadetId);
  return (
    <div
      data-testid="assign-bar"
      role="region"
      aria-label="Asignar pedidos a un cadete"
      className="fixed inset-x-0 bottom-0 z-40 animate-bar-in border-t-4 border-cheddar-400 bg-ink text-white shadow-[0_-8px_32px_rgba(11,31,58,0.35)] lg:left-56"
    >
      <div className="mx-auto max-w-[90rem] px-4 py-3 sm:px-6">
        {failure && (
          <div role="alert" data-testid="assign-error" className="mb-3 flex items-start justify-between gap-3 rounded-xl border-2 border-state-error bg-red-50 px-4 py-2.5 text-ink">
            <div className="min-w-0">
              <p className="font-bold text-state-error">{failure.message}</p>
              {failure.lines.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-sm font-medium">
                  {failure.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
            </div>
            <button type="button" onClick={onDismissFailure} className="min-h-12 shrink-0 rounded-full px-4 font-bold text-state-error hover:bg-red-100">
              Cerrar
            </button>
          </div>
        )}
        {count > 0 && (
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex items-center gap-3 md:min-w-0 md:flex-1">
            <div className="min-w-0">
              <p data-testid="assign-summary" className="font-display text-2xl leading-tight font-extrabold">
                {count} {count === 1 ? "pedido" : "pedidos"}
              </p>
              <p data-testid="assign-cash" className="font-display text-lg leading-tight font-bold text-cheddar-400">
                Efectivo a cobrar {formatARS(cash)}
              </p>
                          </div>
            <button
              type="button"
              onClick={onClear}
              disabled={inFlight}
              className="ml-auto min-h-12 shrink-0 rounded-full border border-white/40 px-4 font-bold hover:bg-white/10 disabled:opacity-50 md:ml-0"
            >
              Limpiar
            </button>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row md:flex-none">
            <label className="sr-only" htmlFor="assign-cadet">
              Cadete
            </label>
            <select
              id="assign-cadet"
              data-testid="cadet-select"
              value={cadetId ?? ""}
              disabled={inFlight}
              onChange={(e) => onCadet(e.target.value === "" ? null : Number(e.target.value))}
              className="min-h-14 rounded-xl border-2 border-white/30 bg-white px-4 text-lg font-bold text-ink focus-visible:outline-cheddar-400 sm:min-w-64"
            >
              <option value="">Elegí un cadete…</option>
              {cadets.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.enRouteCount} en ruta
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid="assign-button"
              title={state.reason ?? undefined}
              disabled={!state.enabled}
              onClick={onAssign}
              className="min-h-14 rounded-full bg-cheddar-400 px-8 font-display text-xl font-extrabold whitespace-nowrap text-ink transition-colors hover:bg-cheddar-600 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/60"
            >
              {inFlight ? "Asignando…" : cadet ? `Asignar a ${cadet.name}` : "Asignar"}
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
