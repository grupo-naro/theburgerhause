"use client";

import { CheckIcon, PinIcon } from "@/components/menu/icons";
import type { DispatchOrder } from "@/lib/orders/dispatch-queries";
import { CancelOrderControl } from "./cancel-dialog";
import { AgeBadge, ItemsSummary, OrderNumber, PaymentBadge, Total, urgencyAccent } from "./card-parts";

type Props = {
  order: DispatchOrder;
  now: number;
  fresh: boolean;
  /** Present only when the role may assign: the card becomes one big selection target. */
  selectable?: { selected: boolean; onToggle: () => void };
  /** The role may cancel the order (a button inside the card, independent of the selection). */
  canCancel?: boolean;
};

function Body({ order, now, reserve, canCancel }: { order: DispatchOrder; now: number; reserve: boolean; canCancel: boolean }) {
  return (
    <>
      <header className={`flex items-start justify-between gap-2 ${reserve ? "pr-14" : ""}`}>
        <OrderNumber number={order.number} className="text-3xl" />
        <AgeBadge order={order} lane="ready" now={now} />
      </header>
      <div className="mt-2 flex items-start gap-2">
        <PinIcon className="mt-1 size-5 shrink-0 text-state-route" />
        <div className="min-w-0 break-words">
          <p data-testid="address" className="text-lg leading-snug font-bold text-ink">
            {order.address}
          </p>
          {order.crossStreets && <p className="text-base text-ink-muted">Entre calles: {order.crossStreets}</p>}
          {order.addressNotes && (
            <p className="mt-1 rounded-md border-l-4 border-state-route bg-violet-50 px-2.5 py-1 text-sm font-medium text-ink">{order.addressNotes}</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <PaymentBadge order={order} />
        <Total cents={order.total} />
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <ItemsSummary items={order.items} />
      </div>
      {canCancel && <CancelOrderControl order={order} />}
    </>
  );
}

/** Ready delivery order. With `selectable` the whole card is a checkbox label (Space toggles when focused). */
export function DeliveryReadyCard({ order, now, fresh, selectable, canCancel = false }: Props) {
  const base = `block rounded-2xl border border-line border-l-8 bg-surface p-4 shadow-sm transition-colors ${urgencyAccent(order, "ready", now)} ${
    fresh ? "animate-card-flash ring-4 ring-cheddar-400" : ""
  }`;
  const common = {
    "data-testid": "dispatch-card",
    "data-lane": "ready-delivery",
    "data-order-number": order.number,
    "data-fresh": fresh ? "true" : undefined,
  } as const;

  if (!selectable) {
    return (
      <article {...common} className={base}>
        <Body order={order} now={now} reserve={false} canCancel={canCancel} />
      </article>
    );
  }
  return (
    <label
      {...common}
      data-selected={selectable.selected ? "true" : undefined}
      className={`${base} relative cursor-pointer ${selectable.selected ? "border-brand-600 bg-brand-50 ring-2 ring-brand-600" : "hover:border-brand-300"}`}
    >
      <input
        type="checkbox"
        data-testid="select-order"
        checked={selectable.selected}
        onChange={selectable.onToggle}
        aria-label={`Seleccionar el pedido #${order.number}`}
        className="peer absolute top-2 right-2 size-12 cursor-pointer appearance-none rounded-xl border-2 border-ink-muted bg-surface checked:border-brand-600 checked:bg-brand-600"
      />
      <CheckIcon className="pointer-events-none absolute top-2 right-2 size-12 p-2.5 text-white opacity-0 peer-checked:opacity-100" />
      <Body order={order} now={now} reserve canCancel={canCancel} />
    </label>
  );
}
