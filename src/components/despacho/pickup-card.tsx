"use client";

import { useState } from "react";
import { markDeliveredAction } from "@/app/(staff)/despacho/actions";
import { needsCollection } from "@/lib/despacho/cash";
import type { DispatchOrder } from "@/lib/orders/dispatch-queries";
import { AgeBadge, BigButton, CardError, OrderNumber, PaymentBadge, Total, urgencyAccent } from "./card-parts";
import { CancelOrderControl } from "./cancel-dialog";
import { CollectDialog } from "./collect-dialog";
import { CallSign } from "./counter-ready-card";
import { useCardAction } from "./use-card-action";

type Props = { order: DispatchOrder; now: number; canControl: boolean };

/** Order waiting at the counter. Web takeaway paid in cash asks to confirm the charge first. */
export function PickupCard({ order, now, canControl }: Props) {
  const { exec, busy, error, clearError } = useCardAction();
  const [collecting, setCollecting] = useState(false);
  const collect = needsCollection(order);

  const deliver = (collected?: boolean) =>
    exec(() => markDeliveredAction(collected ? { orderId: order.id, collected: true } : { orderId: order.id }), () => setCollecting(false));

  return (
    <article
      data-testid="dispatch-card"
      data-lane="pickup"
      data-order-number={order.number}
      data-leaving={busy ? "true" : undefined}
      className={`rounded-2xl border border-line border-l-8 bg-surface p-4 shadow-sm transition-opacity ${
        urgencyAccent(order, "pickup", now) === "border-l-transparent" ? "border-l-state-route" : urgencyAccent(order, "pickup", now)
      } ${busy && !collecting ? "opacity-60" : ""}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <CallSign order={order} tone="text-state-route" />
        <div className="flex flex-col items-end gap-2">
          <OrderNumber number={order.number} className="text-3xl" />
          <AgeBadge order={order} lane="pickup" now={now} />
        </div>
      </header>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <PaymentBadge order={order} />
        <Total cents={order.total} className="text-xl" />
      </div>
      {canControl && (
        <div className="mt-4">
          {error && !collecting && <CardError>{error}</CardError>}
          <BigButton
            tone="green"
            data-testid="deliver"
            disabled={busy}
            aria-label={`Entregar el pedido #${order.number}`}
            onClick={() => {
              if (collect) {
                clearError();
                setCollecting(true);
              } else deliver();
            }}
            className="w-full"
          >
            Entregado
          </BigButton>
          <CancelOrderControl order={order} disabled={busy} />
        </div>
      )}
      {collecting && (
        <CollectDialog
          orderNumber={order.number}
          total={order.total}
          busy={busy}
          error={error}
          onCancel={() => setCollecting(false)}
          onConfirm={() => deliver(true)}
        />
      )}
    </article>
  );
}
