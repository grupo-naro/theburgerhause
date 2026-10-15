"use client";

import type { CajaOrder } from "@/lib/orders/caja-queries";
import { OrderCard } from "./order-card";

type Props = {
  /** Orders to render (live ones plus frozen "handled elsewhere" ones), oldest first. */
  orders: CajaOrder[];
  pendingCount: number;
  now: number;
  freshIds: ReadonlySet<number>;
  resolved: ReadonlyMap<number, string>;
  onConflict: (order: CajaOrder, message: string) => void;
  onDismiss: (orderId: number) => void;
  toolbar: React.ReactNode;
};

export function PendingSection({ orders, pendingCount, now, freshIds, resolved, onConflict, onDismiss, toolbar }: Props) {
  return (
    <section aria-labelledby="pendientes-title" data-testid="pending-section" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="pendientes-title" className="flex items-center gap-3 font-display text-2xl font-extrabold text-ink">
          Pendientes de aprobación
          <span
            data-testid="pending-count"
            aria-label={`${pendingCount} pedidos pendientes`}
            className={`inline-flex min-w-14 items-center justify-center rounded-full px-4 py-1 text-3xl tabular-nums ${
              pendingCount > 0 ? "bg-state-pending text-ink" : "bg-slate-100 text-ink-muted"
            }`}
          >
            {pendingCount}
          </span>
        </h2>
        {toolbar}
      </div>

      {orders.length === 0 ? (
        <div
          data-testid="pending-empty"
          className="rounded-2xl border-2 border-dashed border-line bg-surface px-6 py-12 text-center"
        >
          <p className="font-display text-2xl font-bold text-ink">Todo al día</p>
          <p className="mt-1 text-lg text-ink-muted">No hay pedidos esperando aprobación. Cuando llegue uno, suena y aparece acá.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,26rem),1fr))] items-start gap-4">
          {orders.map((o) => (
            <li key={o.id} className="min-w-0">
              <OrderCard
                order={o}
                now={now}
                fresh={freshIds.has(o.id)}
                resolved={resolved.get(o.id) ?? null}
                onConflict={onConflict}
                onDismiss={onDismiss}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
