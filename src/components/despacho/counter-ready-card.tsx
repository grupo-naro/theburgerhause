"use client";

import { markPickupAction } from "@/app/(staff)/despacho/actions";
import type { DispatchOrder } from "@/lib/orders/dispatch-queries";
import { AgeBadge, BigButton, CardError, ItemsSummary, OrderNumber, PaymentBadge, Total, urgencyAccent } from "./card-parts";
import { CancelOrderControl } from "./cancel-dialog";
import { useCardAction } from "./use-card-action";

type Props = { order: DispatchOrder; now: number; fresh: boolean; canControl: boolean };

/** The big identifier staff shout: the pager (counter) or the customer's first name (web takeaway). */
export function CallSign({ order, tone = "text-ink" }: { order: DispatchOrder; tone?: string }) {
  if (order.pagerNumber !== null) {
    return (
      <div data-testid="pager-number" className={`${tone}`}>
        <p className="text-sm font-extrabold tracking-widest uppercase opacity-80">Llamador</p>
        <p className="font-display text-7xl leading-none font-extrabold tabular-nums">{order.pagerNumber}</p>
      </div>
    );
  }
  return (
    <div data-testid="pickup-name" className={tone}>
      <p className="text-sm font-extrabold tracking-widest uppercase opacity-80">Retira</p>
      <p className="font-display text-4xl leading-tight font-extrabold break-words">{order.customerName ?? "Cliente"}</p>
    </div>
  );
}

/** Ready counter/takeaway order: "Llamar / Para retirar" moves it to Para retirar. */
export function CounterReadyCard({ order, now, fresh, canControl }: Props) {
  const { exec, busy, error } = useCardAction();
  return (
    <article
      data-testid="dispatch-card"
      data-lane="ready-counter"
      data-order-number={order.number}
      data-fresh={fresh ? "true" : undefined}
      data-leaving={busy ? "true" : undefined}
      className={`rounded-2xl border border-line border-l-8 bg-surface p-4 shadow-sm transition-opacity ${urgencyAccent(order, "ready", now)} ${
        fresh ? "animate-card-flash ring-4 ring-cheddar-400" : ""
      } ${busy ? "opacity-60" : ""}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <CallSign order={order} />
        <div className="flex flex-col items-end gap-2">
          <OrderNumber number={order.number} className="text-3xl" />
          <AgeBadge order={order} lane="ready" now={now} />
        </div>
      </header>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <PaymentBadge order={order} />
        <Total cents={order.total} className="text-xl" />
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <ItemsSummary items={order.items} />
      </div>
      {canControl && (
        <div className="mt-4">
          {error && <CardError>{error}</CardError>}
          <BigButton
            tone="violet"
            data-testid="call-pickup"
            disabled={busy}
            aria-label={`Llamar al cliente del pedido #${order.number}: pasa a Para retirar`}
            onClick={() => exec(() => markPickupAction({ orderId: order.id }))}
            className="w-full"
          >
            Llamar / Para retirar
          </BigButton>
          <CancelOrderControl order={order} disabled={busy} />
        </div>
      )}
    </article>
  );
}
