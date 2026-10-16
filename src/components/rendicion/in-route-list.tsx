import { formatMoney } from "@/lib/rendicion/shortage";
import type { InRouteOrder } from "@/lib/settlements/queries";

/** Informational only: orders still on the street are NOT part of what the cadet owes yet. */
export function InRouteList({ orders }: { orders: InRouteOrder[] }) {
  if (orders.length === 0) return null;
  return (
    <section data-testid="inroute-section" aria-labelledby="inroute-h" className="rounded-2xl border border-dashed border-state-route/60 bg-violet-50/50 p-5">
      <h3 id="inroute-h" className="font-display text-xl font-extrabold text-state-route">
        En ruta ahora
      </h3>
      <p className="text-base text-ink-muted">Todavía no los entregó: no entran en esta rendición.</p>
      <ul className="mt-3 divide-y divide-violet-200">
        {orders.map((o) => (
          <li key={o.id} data-testid="inroute-row" className="flex items-center justify-between gap-3 py-2 text-base">
            <span className="font-bold">#{o.number}</span>
            <span className="text-ink-muted">{o.paymentMethod === "cash" ? "Efectivo" : "Transferencia"}</span>
            <span className="font-bold tabular-nums">{formatMoney(o.total)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
