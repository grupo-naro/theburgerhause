"use client";

import { useId, useState } from "react";
import { ChevronDownIcon } from "@/components/menu/icons";
import { formatARS } from "@/domain/money";
import { elapsedMs, formatElapsed } from "@/lib/caja/elapsed";
import { canReprint, formatOrderTime, printChips } from "@/lib/caja/labels";
import type { CajaOrder } from "@/lib/orders/caja-queries";
import { PaymentChip, PrintChip, ServiceChip, StatusChip } from "./chips";
import { ReprintMenu } from "./reprint-menu";

function paymentLine(o: CajaOrder): string {
  if (o.status === "cancelado") return "Sin cobro";
  return o.paymentStatus === "paid" ? "Pagado" : "Cobro pendiente";
}

function RecentRow({ order, now }: { order: CajaOrder; now: number }) {
  const chips = canReprint(order.status) ? printChips(order.printState) : [];
  return (
    <li data-testid="recent-row" data-order-number={order.number} className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-display text-2xl font-extrabold text-ink">#{order.number}</span>
          <StatusChip status={order.status} />
          <span className="truncate font-semibold text-ink">{order.customerName}</span>
        </div>
        {canReprint(order.status) && <ReprintMenu orderId={order.id} orderNumber={order.number} />}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-muted">
        <span className="tabular-nums">
          {formatOrderTime(order.createdAt)} hs · {formatElapsed(elapsedMs(order.createdAt, new Date(now)))}
        </span>
        <ServiceChip fulfillment={order.fulfillment} />
        <PaymentChip method={order.paymentMethod} />
        <span data-testid="payment-state" className="font-semibold text-ink">
          {paymentLine(order)} · <span className="tabular-nums">{formatARS(order.total)}</span>
        </span>
        {chips.map((c) => (
          <PrintChip key={c.state} state={c.state} label={c.label} />
        ))}
      </div>
    </li>
  );
}

/** Last processed orders. Always open on desktop; a toggle on tablets/phones (collapsed by default). */
export function RecentSection({ orders, now }: { orders: CajaOrder[]; now: number }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section aria-labelledby={`${bodyId}-title`} data-testid="recent-section" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${bodyId}-title`} className="font-display text-2xl font-extrabold text-ink">
          Recientes <span className="text-ink-muted tabular-nums">({orders.length})</span>
        </h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-12 items-center gap-2 rounded-full border border-line bg-surface px-5 font-bold text-ink hover:bg-brand-50 lg:hidden"
        >
          {open ? "Ocultar" : "Mostrar"}
          <ChevronDownIcon className={`size-5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      <div id={bodyId} className={open ? "block" : "hidden lg:block"}>
        {orders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-ink-muted">
            Todavía no hay pedidos procesados.
          </p>
        ) : (
          <ul className="grid gap-3 xl:grid-cols-2">
            {orders.map((o) => (
              <RecentRow key={o.id} order={o} now={now} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
