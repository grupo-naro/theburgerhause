import { formatARS } from "@/domain/money";
import type { TrackingOrder } from "@/lib/orders/tracking";

const row = "flex items-baseline justify-between gap-3";

/** Read-only summary of what was ordered; every amount comes from the order snapshots. */
export function OrderSummary({ order }: { order: TrackingOrder }) {
  return (
    <section
      aria-labelledby="pedido-h-resumen"
      data-testid="order-summary"
      className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5"
    >
      <h2 id="pedido-h-resumen" className="font-display text-xl font-extrabold text-ink">
        Tu pedido
      </h2>
      <ul className="mt-3 space-y-3">
        {order.groups.map((g, i) => (
          <li key={i} data-testid="order-line" className="border-b border-line pb-3 last:border-b-0 last:pb-0">
            <div className={row}>
              <p className="min-w-0 font-bold leading-snug text-ink">
                <span className="tabular-nums">{g.quantity}×</span> {g.name}
              </p>
              <p className="shrink-0 font-bold tabular-nums text-ink">{formatARS(g.lineTotal)}</p>
            </div>
            {g.modifiers.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Modificaciones">
                {g.modifiers.map((m, j) => (
                  <li key={j} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium leading-tight text-brand-700">
                    {m.name}
                    {m.priceDelta !== 0 && (
                      <span className="ml-1 font-bold tabular-nums">
                        {m.priceDelta > 0 ? "+ " : "− "}
                        {formatARS(Math.abs(m.priceDelta))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {g.note && <p className="mt-1 text-sm italic leading-snug text-ink-muted">“{g.note}”</p>}
          </li>
        ))}
      </ul>
      <dl className="mt-4 space-y-1.5 border-t border-line pt-4">
        <div className={row}>
          <dt className="text-ink-muted">Subtotal</dt>
          <dd data-testid="order-subtotal" className="font-medium tabular-nums text-ink">
            {formatARS(order.subtotal)}
          </dd>
        </div>
        {order.fulfillment === "delivery" && (
          <div className={row}>
            <dt className="text-ink-muted">Envío</dt>
            <dd data-testid="order-delivery-fee" className="font-medium tabular-nums text-ink">
              {order.deliveryFee === 0 ? "Gratis" : formatARS(order.deliveryFee)}
            </dd>
          </div>
        )}
        <div className={`${row} pt-1`}>
          <dt className="font-display text-lg font-bold text-ink">Total</dt>
          <dd data-testid="order-total" className="font-display text-2xl font-extrabold tabular-nums text-ink">
            {formatARS(order.total)}
          </dd>
        </div>
      </dl>
      {order.pendingAddons.length > 0 && (
        <div data-testid="pending-addons" className="mt-4 space-y-2 rounded-2xl bg-brand-50 p-3">
          <h3 className="font-display text-base font-bold text-ink">Adicional pendiente de pago</h3>
          {order.pendingAddons.map((a) => (
            <div key={a.seq} data-testid="pending-addon" className="border-t border-line pt-2 first:border-t-0 first:pt-0">
              <ul className="space-y-0.5 text-sm text-ink">
                {a.lines.map((l, i) => (
                  <li key={i}>
                    <span className="tabular-nums">{l.quantity}×</span> {l.name}
                  </li>
                ))}
              </ul>
              <p className={`${row} mt-1 text-sm`}>
                <span className="text-ink-muted">Pendiente de pago</span>
                <span data-testid="pending-addon-subtotal" className="font-bold tabular-nums text-ink">
                  {formatARS(a.subtotal)}
                </span>
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
