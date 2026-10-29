"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { markReadyAction } from "@/app/(staff)/despacho/actions";
import { AddonBlock } from "@/components/orders/addon-block";
import { useEditorAvailable } from "@/components/orders/editor-menu";
import { OrderEditorDialog } from "@/components/orders/order-editor-dialog";
import { useToast } from "@/components/ui/toast";
import { editorItemsFromGroups } from "@/lib/orders/editor-math";
import { Chip } from "@/components/caja/chips";
import { FULFILLMENT_LABEL } from "@/lib/caja/labels";
import type { DispatchOrder } from "@/lib/orders/dispatch-queries";
import { AgeBadge, BigButton, CardError, ItemsSummary, OrderNumber, urgencyAccent } from "./card-parts";
import { CancelOrderControl } from "./cancel-dialog";
import { TandaField } from "./tanda-field";
import { useCardAction } from "./use-card-action";

type Props = { order: DispatchOrder; now: number; canMark: boolean; /** The role may write the tanda of a delivery order. */ canEditTanda?: boolean };

/** Where the order goes, in one chip: LLAMADOR 7 (counter) / Delivery / Retiro. */
export function DestinationChip({ order }: { order: DispatchOrder }) {
  if (order.pagerNumber !== null) {
    return (
      <Chip data-testid="pager-chip" className="bg-ink text-white">
        LLAMADOR {order.pagerNumber}
      </Chip>
    );
  }
  return (
    <Chip className={order.fulfillment === "delivery" ? "bg-violet-100 text-violet-800" : "bg-brand-50 text-brand-700"}>
      {FULFILLMENT_LABEL[order.fulfillment]}
    </Chip>
  );
}

/** Compact line under the number: first address line / customer name. */
export function WhereLine({ order }: { order: DispatchOrder }) {
  const text = order.fulfillment === "delivery" ? order.address : order.channel === "counter" ? "Mostrador" : order.customerName;
  if (!text) return null;
  return <p className="min-w-0 truncate text-base font-semibold text-ink">{text}</p>;
}

export function PreparingCard({ order, now, canMark, canEditTanda = false }: Props) {
  const { exec, busy, error } = useCardAction();
  const router = useRouter();
  const toast = useToast();
  const canEdit = useEditorAvailable();
  const [adding, setAdding] = useState(false);
  return (
    <article
      data-testid="dispatch-card"
      data-lane="preparing"
      data-order-number={order.number}
      data-leaving={busy ? "true" : undefined}
      className={`rounded-2xl border border-line border-l-8 bg-surface p-4 shadow-sm transition-opacity ${urgencyAccent(order, "preparing", now)} ${busy ? "opacity-60" : ""}`}
    >
      <header className="flex items-start justify-between gap-2">
        <OrderNumber number={order.number} className="text-3xl" />
        <AgeBadge order={order} lane="preparing" now={now} />
      </header>
      <div className="mt-2 flex items-center gap-2">
        <DestinationChip order={order} />
        <WhereLine order={order} />
      </div>
      {order.fulfillment === "delivery" && <TandaField orderId={order.id} number={order.number} tanda={order.tanda} canEdit={canEditTanda} />}
      <div className="mt-3 border-t border-line pt-3">
        <ItemsSummary items={order.items} />
      </div>
      {order.addons.length > 0 && (
        <div className="mt-3">
          <AddonBlock orderId={order.id} addons={order.addons} onChanged={() => router.refresh()} />
        </div>
      )}
      {canMark && (
        <div className="mt-4">
          {error && <CardError>{error}</CardError>}
          {canEdit && (
            <BigButton
              tone="ghost"
              data-testid="add-products"
              disabled={busy}
              aria-label={`Agregar productos al pedido #${order.number}`}
              onClick={() => setAdding(true)}
              className="mb-2 w-full !text-base"
            >
              Agregar productos
            </BigButton>
          )}
          <BigButton
            tone="green"
            data-testid="mark-ready"
            disabled={busy}
            aria-label={`Marcar listo el pedido #${order.number}`}
            onClick={() =>
              exec(
                () => markReadyAction({ orderId: order.id }),
                (data) => {
                  if ((data?.cancelledAddons ?? 0) > 0) toast.show({ message: "Se canceló el adicional sin pagar" });
                },
              )
            }
            className="w-full"
          >
            Listo
          </BigButton>
          <CancelOrderControl order={order} disabled={busy} />
        </div>
      )}
      {adding && (
        <OrderEditorDialog
          mode="add"
          orderId={order.id}
          items={editorItemsFromGroups(order.items)}
          open
          onClose={() => setAdding(false)}
          channel={order.channel}
          paymentMethod={order.paymentMethod}
        />
      )}
    </article>
  );
}
