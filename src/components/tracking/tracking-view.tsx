import { formatARS } from "@/domain/money";
import type { TrackingOrder } from "@/lib/orders/tracking";
import { trackingSteps } from "@/lib/orders/tracking-steps";
import type { CheckoutInfo } from "@/lib/settings/checkout-info";
import type { PublicStoreInfo } from "@/lib/menu/queries";
import { ContactButtons } from "./contact-buttons";
import { FulfillmentBlock } from "./fulfillment-block";
import { OrderSummary } from "./order-summary";
import { PaymentBlock } from "./payment-block";
import { StatusPoller } from "./status-poller";
import { Timeline } from "./timeline";

const card = "rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5";

/** `/pedido/[token]`: number, live status, timeline, payment, address / pickup, summary and contact. */
export function TrackingView({
  token,
  order,
  store,
  bank,
  justPlaced,
}: {
  token: string;
  order: TrackingOrder;
  store: PublicStoreInfo;
  /** Bank data, only while a transfer still has to be verified. */
  bank: Pick<CheckoutInfo, "bankAlias" | "bankCbu"> | null;
  /** First render after checkout: the headline celebrates instead of only informing. */
  justPlaced: boolean;
}) {
  const view = trackingSteps(order.status, order.fulfillment, order.paymentMethod);
  const headline = justPlaced && order.status === "pendiente_aprobacion" ? "¡Recibimos tu pedido!" : view.headline;
  const contact = (
    <ContactButtons number={order.number} whatsapp={store.whatsapp} phone={store.storePhone} showPhone={view.cancelled} />
  );

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-8 pt-6 md:pt-8" data-testid="tracking" data-status={order.status}>
      <StatusPoller token={token} status={order.status} paymentStatus={order.paymentStatus} />
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-4">
          <section
            aria-labelledby="pedido-h-estado"
            className={`${card} ${view.cancelled ? "border-state-error bg-red-50" : ""}`}
            data-testid={view.cancelled ? "cancelled-card" : "status-card"}
          >
            <p className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
              {order.firstName ? `${order.firstName}, este es tu pedido` : "Tu pedido"}
            </p>
            <h1 id="pedido-h-estado" data-testid="order-number" className="font-display text-5xl font-extrabold leading-none text-brand-700">
              #{order.number}
            </h1>
            <div aria-live="polite" className="mt-3">
              <p data-testid="status-headline" className="font-display text-2xl font-extrabold leading-tight text-ink">
                {headline}
              </p>
              <p data-testid="status-hint" className="mt-1 text-ink-muted">
                {view.hint}
              </p>
            </div>
            {view.cancelled ? (
              <div className="mt-4">{contact}</div>
            ) : (
              <div className="mt-6">
                <Timeline steps={view.steps} />
              </div>
            )}
          </section>

          {!view.cancelled && (
            <>
              <FulfillmentBlock order={order} store={store} />
              <PaymentBlock
                paymentMethod={order.paymentMethod}
                paid={order.paymentStatus === "paid"}
                fulfillment={order.fulfillment}
                total={order.total}
                bank={bank ? { alias: bank.bankAlias, cbu: bank.bankCbu } : null}
              />
            </>
          )}
        </div>

        <div className="space-y-4">
          <OrderSummary order={order} />
          {!view.cancelled && (
            <div className={card}>
              <p className="mb-3 text-sm text-ink-muted">
                ¿Dudas con tu pedido de {formatARS(order.total)}? Escribinos y lo vemos.
              </p>
              {contact}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
