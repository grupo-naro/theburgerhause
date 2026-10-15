import { ClockIcon, PinIcon } from "@/components/menu/icons";
import type { TrackingOrder } from "@/lib/orders/tracking";

type Store = { storeAddress: string; openingHoursText: string };

/** Delivery: the address the customer gave. Takeaway: where and when to pick it up. */
export function FulfillmentBlock({ order, store }: { order: TrackingOrder; store: Store }) {
  const delivery = order.fulfillment === "delivery";
  return (
    <section
      aria-labelledby="pedido-h-entrega"
      data-testid="fulfillment-block"
      className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5"
    >
      <h2 id="pedido-h-entrega" className="font-display text-xl font-extrabold text-ink">
        {delivery ? "Entrega" : "Retiro en el local"}
      </h2>
      {delivery ? (
        <p data-testid="delivery-address" className="mt-3 flex items-start gap-2 text-ink">
          <PinIcon className="mt-0.5 size-5 shrink-0 text-brand-600" />
          <span>
            Te lo llevamos a <strong className="break-words">{order.addressLine}</strong>
          </span>
        </p>
      ) : (
        <div data-testid="pickup-info" className="mt-3 space-y-2 text-ink">
          {store.storeAddress && (
            <p className="flex items-start gap-2">
              <PinIcon className="mt-3 size-5 shrink-0 text-brand-600" />
              <a
                data-testid="pickup-address"
                className="inline-flex min-h-11 items-center font-bold text-brand-600 underline underline-offset-4"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(store.storeAddress)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {store.storeAddress}
              </a>
            </p>
          )}
          {store.openingHoursText && (
            <p className="flex items-start gap-2 text-sm">
              <ClockIcon className="mt-0.5 size-5 shrink-0 text-brand-600" />
              <span className="whitespace-pre-line">{store.openingHoursText}</span>
            </p>
          )}
          {!store.storeAddress && !store.openingHoursText && <p>Retirás tu pedido en el local.</p>}
        </div>
      )}
    </section>
  );
}
