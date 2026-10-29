"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { approveOrderAction, rejectOrderAction } from "@/app/(staff)/caja/actions";
import { ClockIcon } from "@/components/menu/icons";
import { OrderEditorDialog } from "@/components/orders/order-editor-dialog";
import { useEditorAvailable } from "@/components/orders/editor-menu";
import { formatARS } from "@/domain/money";
import { editorItemsFromGroups } from "@/lib/orders/editor-math";
import { formatOrderTime } from "@/lib/caja/labels";
import type { CajaOrder } from "@/lib/orders/caja-queries";
import { ElapsedBadge, urgencyBar } from "./elapsed-badge";
import { PaymentChip, ServiceChip } from "./chips";
import { CustomerBlock } from "./customer-block";
import { OrderActions } from "./order-actions";
import { OrderItems } from "./order-items";
import { RejectDialog } from "./reject-dialog";
import { useGuardedAction } from "./use-guarded-action";

const REFRESH_AFTER_ACTION_MS = 1500;

type Props = {
  order: CajaOrder;
  now: number;
  /** Highlighted as a brand-new arrival. */
  fresh: boolean;
  /** Set when another cashier already handled this order: the card freezes and explains. */
  resolved: string | null;
  onConflict: (order: CajaOrder, message: string) => void;
  onDismiss: (orderId: number) => void;
};

function Totals({ order }: { order: CajaOrder }) {
  const row = "flex items-baseline justify-between gap-3";
  return (
    <dl className="space-y-1">
      <div className={`${row} text-ink-muted`}>
        <dt>Subtotal</dt>
        <dd className="tabular-nums">{formatARS(order.subtotal)}</dd>
      </div>
      {order.fulfillment === "delivery" && (
        <div className={`${row} text-ink-muted`}>
          <dt>Envío</dt>
          <dd className="tabular-nums">{order.deliveryFee === 0 ? "Gratis" : formatARS(order.deliveryFee)}</dd>
        </div>
      )}
      <div className={`${row} pt-1`}>
        <dt className="font-display text-xl font-bold text-ink">TOTAL</dt>
        <dd data-testid="order-total" className="font-display text-3xl font-extrabold text-ink tabular-nums">
          {formatARS(order.total)}
        </dd>
      </div>
    </dl>
  );
}

export function OrderCard({ order, now, fresh, resolved, onConflict, onDismiss }: Props) {
  const router = useRouter();
  const { run, pending, error, clearError } = useGuardedAction();
  const [leaving, setLeaving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [editing, setEditing] = useState(false);
  const canEdit = useEditorAvailable();
  const rejectRef = useRef<HTMLButtonElement>(null);
  const busy = pending || leaving;
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const pendingTimers = timers.current;
    return () => pendingTimers.forEach((h) => window.clearTimeout(h));
  }, []);

  const afterSuccess = () => {
    setRejecting(false);
    setLeaving(true);
    // The SSE event normally removes the card first; this covers a stalled stream.
    timers.current.push(window.setTimeout(() => router.refresh(), REFRESH_AFTER_ACTION_MS));
  };
  const onFail = (f: { code: string; message: string }) => {
    if (f.code === "INVALID_TRANSITION" || f.code === "NOT_FOUND") {
      setRejecting(false);
      onConflict(order, f.message);
      router.refresh();
    }
  };

  const approve = (paymentVerified: boolean) =>
    run(() => approveOrderAction({ orderId: order.id, paymentVerified }), { lockOnSuccess: true, onOk: afterSuccess, onFail });
  const reject = (reason: string) =>
    run(() => rejectOrderAction({ orderId: order.id, reason }), { lockOnSuccess: true, onOk: afterSuccess, onFail });
  const closeDialog = () => {
    setRejecting(false);
    timers.current.push(window.setTimeout(() => rejectRef.current?.focus(), 0));
  };

  return (
    <article
      aria-labelledby={`order-${order.id}-title`}
      data-testid="order-card"
      data-order-number={order.number}
      data-fresh={fresh ? "true" : undefined}
      data-leaving={leaving ? "true" : undefined}
      data-resolved={resolved ? "true" : undefined}
      className={`rounded-2xl border border-line border-l-8 bg-surface p-5 shadow-sm transition-all duration-300 ${urgencyBar(order.createdAt, now)} ${
        fresh ? "animate-card-flash ring-4 ring-cheddar-400" : ""
      } ${leaving ? "scale-95 opacity-0" : ""} ${resolved ? "opacity-70 grayscale-[40%]" : ""}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 id={`order-${order.id}-title`} className="font-display text-4xl leading-none font-extrabold text-ink">
            <span className="text-ink-muted">#</span>
            {order.number}
          </h3>
          <p className="mt-1.5 flex items-center gap-1.5 text-base text-ink-muted">
            <ClockIcon className="size-4" />
            <time dateTime={order.createdAt}>{formatOrderTime(order.createdAt)} hs</time>
          </p>
        </div>
        <ElapsedBadge createdAt={order.createdAt} now={now} />
      </header>

      <div className="mt-3 flex flex-wrap gap-2">
        <ServiceChip fulfillment={order.fulfillment} />
        <PaymentChip method={order.paymentMethod} />
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <CustomerBlock order={order} />
      </div>
      <div className="mt-4 border-t border-line pt-4">
        <OrderItems items={order.items} />
      </div>
      <div className="mt-4 border-t border-line pt-4">
        <Totals order={order} />
      </div>

      <div className="mt-5">
        {resolved ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-state-pending bg-amber-50 px-4 py-3">
            <p role="status" data-testid="card-conflict" className="text-base font-semibold text-ink">
              {resolved}
            </p>
            <button
              type="button"
              onClick={() => onDismiss(order.id)}
              className="min-h-12 rounded-full border border-line bg-surface px-5 font-bold text-ink hover:bg-brand-50"
            >
              Entendido
            </button>
          </div>
        ) : (
          <>
            {error && !rejecting && (
              <p
                role="alert"
                data-testid="card-error"
                className="mb-3 rounded-xl border border-state-error bg-red-50 px-4 py-2 text-base font-medium text-state-error"
              >
                {error}
              </p>
            )}
            {canEdit && (
              <button
                type="button"
                data-testid="edit-order"
                disabled={busy}
                aria-label={`Editar pedido #${order.number}`}
                onClick={() => setEditing(true)}
                className="mb-3 min-h-12 w-full rounded-full border-2 border-line bg-surface px-6 font-display text-base font-bold text-ink transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Editar pedido
              </button>
            )}
            <OrderActions
              orderNumber={order.number}
              paymentMethod={order.paymentMethod}
              total={order.total}
              busy={busy}
              onApprove={approve}
              onReject={() => {
                clearError();
                setRejecting(true);
              }}
              rejectRef={rejectRef}
            />
          </>
        )}
      </div>

      {editing && (
        <OrderEditorDialog
          mode="edit"
          orderId={order.id}
          items={editorItemsFromGroups(order.items)}
          open
          onClose={() => setEditing(false)}
          channel={order.channel}
          paymentMethod={order.paymentMethod}
          deliveryFee={order.deliveryFee}
        />
      )}
      {rejecting && (
        <RejectDialog
          orderNumber={order.number}
          busy={busy}
          error={error}
          onCancel={closeDialog}
          onConfirm={reject}
        />
      )}
    </article>
  );
}
