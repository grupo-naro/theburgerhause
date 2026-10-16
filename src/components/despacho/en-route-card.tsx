"use client";

import Link from "next/link";
import { useState } from "react";
import { markDeliveredAction, returnToDispatchAction } from "@/app/(staff)/despacho/actions";
import { PhoneIcon, PinIcon } from "@/components/menu/icons";
import { formatARS } from "@/domain/money";
import type { Capabilities } from "@/lib/despacho/roles";
import type { DispatchOrder, EnRouteGroup } from "@/lib/orders/dispatch-queries";
import { AgeBadge, BigButton, CardError, OrderNumber, PaymentBadge, Total } from "./card-parts";
import { ReturnDialog } from "./return-dialog";
import { useCardAction } from "./use-card-action";

function RouteOrder({ order, now, canControl }: { order: DispatchOrder; now: number; canControl: boolean }) {
  const { exec, busy, error, clearError } = useCardAction();
  const [returning, setReturning] = useState(false);
  return (
    <li
      data-testid="route-order"
      data-order-number={order.number}
      data-leaving={busy ? "true" : undefined}
      className={`rounded-xl border border-line bg-surface p-3 transition-opacity ${busy && !returning ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <OrderNumber number={order.number} className="text-2xl" />
        <Total cents={order.total} className="text-xl" />
      </div>
      <p className="mt-1 flex items-start gap-1.5 text-base font-semibold break-words text-ink">
        <PinIcon className="mt-0.5 size-4 shrink-0 text-state-route" />
        {order.address}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <PaymentBadge order={order} />
        <AgeBadge order={order} lane="enRoute" now={now} label="Pedido de" />
      </div>
      {canControl && (
        <div className="mt-3">
          {error && !returning && <CardError>{error}</CardError>}
          <div className="grid grid-cols-2 gap-2">
            <BigButton
              tone="green"
              data-testid="deliver"
              disabled={busy}
              aria-label={`Entregado: pedido #${order.number}`}
              onClick={() => exec(() => markDeliveredAction({ orderId: order.id }))}
              className="!px-3"
            >
              Entregado
            </BigButton>
            <BigButton
              tone="danger"
              data-testid="return-order"
              disabled={busy}
              aria-label={`No se pudo entregar el pedido #${order.number}`}
              onClick={() => {
                clearError();
                setReturning(true);
              }}
              className="!px-3 !text-base leading-tight"
            >
              No se pudo entregar
            </BigButton>
          </div>
        </div>
      )}
      {returning && (
        <ReturnDialog
          orderNumber={order.number}
          busy={busy}
          error={error}
          onCancel={() => setReturning(false)}
          onConfirm={(reason) => exec(() => returnToDispatchAction({ orderId: order.id, reason }), () => setReturning(false))}
        />
      )}
    </li>
  );
}

/** One cadet out on the street: who, how much cash they carry and their orders. */
export function EnRouteCard({ group, phone, now, caps }: { group: EnRouteGroup; phone: string | null; now: number; caps: Capabilities }) {
  const { cadet, orders, cashPending } = group;
  const hasCash = orders.some((o) => o.paymentMethod === "cash" && o.paymentStatus === "pending");
  return (
    <section
      data-testid="cadet-group"
      data-cadet-id={cadet.id}
      aria-label={`Cadete ${cadet.name}`}
      className="rounded-2xl border border-line border-t-8 border-t-state-route bg-surface p-4 shadow-sm"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-2xl leading-tight font-extrabold text-ink">{cadet.name}</h3>
          {phone && (
            <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="mt-1 inline-flex min-h-8 items-center gap-1.5 text-base font-semibold text-brand-600 underline underline-offset-4">
              <PhoneIcon className="size-4" />
              {phone}
            </a>
          )}
        </div>
        <span data-testid="route-count" className="rounded-full bg-violet-100 px-3 py-1 text-base font-bold whitespace-nowrap text-violet-800">
          {orders.length} {orders.length === 1 ? "pedido" : "pedidos"}
        </span>
      </header>

      <div className={`mt-3 rounded-xl px-4 py-2.5 ${hasCash ? "bg-cheddar-400/40 ring-1 ring-cheddar-600/60" : "bg-slate-100"}`}>
        <p className="text-sm font-bold tracking-wide text-ink-muted uppercase">Efectivo a rendir</p>
        <p data-testid="cash-pending" className="font-display text-3xl leading-tight font-extrabold text-ink tabular-nums">
          {formatARS(cashPending)}
        </p>
        {hasCash && <p className="text-sm text-ink-muted">El efectivo se rinde cuando vuelve el cadete.</p>}
      </div>

      <ul className="mt-3 space-y-3" aria-label={`Pedidos de ${cadet.name}`}>
        {orders.map((o) => (
          <RouteOrder key={o.id} order={o} now={now} canControl={caps.canControlDelivery} />
        ))}
      </ul>

      {caps.canRender && (
        <Link
          href={`/despacho/rendicion?cadet=${cadet.id}`}
          data-testid="render-link"
          className="mt-4 flex min-h-14 items-center justify-center rounded-full border-2 border-state-route px-5 font-display text-lg font-bold text-state-route hover:bg-violet-50"
        >
          Rendir
        </Link>
      )}
    </section>
  );
}
