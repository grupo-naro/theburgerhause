import { ChatIcon, PinIcon } from "@/components/menu/icons";
import { whatsappHref } from "@/lib/caja/labels";
import type { CajaOrder } from "@/lib/orders/caja-queries";

/** Who ordered and where it goes: contact link, address and the notes the cadet needs. */
export function CustomerBlock({ order }: { order: CajaOrder }) {
  const wa = whatsappHref(order.whatsapp);
  return (
    <div data-testid="customer" className="space-y-1.5 text-base">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <strong className="text-lg text-ink">{order.customerName}</strong>
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full text-brand-600 underline underline-offset-4"
          >
            <ChatIcon className="size-4" />
            {order.whatsapp}
          </a>
        ) : (
          order.whatsapp && <span className="text-ink-muted">{order.whatsapp}</span>
        )}
      </p>
      {order.fulfillment === "delivery" ? (
        <div className="flex items-start gap-2">
          <PinIcon className="mt-1 size-5 shrink-0 text-state-route" />
          <div className="min-w-0 break-words">
            <p data-testid="address" className="font-semibold text-ink">
              {order.address}
            </p>
            {order.crossStreets && <p className="text-ink-muted">Entre calles: {order.crossStreets}</p>}
            {order.addressNotes && (
              <p className="mt-1 rounded-md border-l-4 border-state-route bg-violet-50 px-2.5 py-1 text-sm font-medium text-ink">
                {order.addressNotes}
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="flex items-center gap-2 font-semibold text-ink">
          <PinIcon className="size-5 shrink-0 text-brand-600" />
          Retira en el local
        </p>
      )}
    </div>
  );
}
