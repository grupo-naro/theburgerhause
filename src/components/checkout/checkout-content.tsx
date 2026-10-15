"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { FormMessage } from "@/components/ui/form-message";
import { formatARS } from "@/domain/money";
import type { CheckoutInfo } from "@/lib/settings/checkout-info";
import { CheckoutSkeleton } from "./checkout-skeleton";
import { CustomerSection } from "./customer-section";
import { ClosedInline, ErrorSummary, UnitsInvalidBanner } from "./error-banners";
import { FulfillmentSection } from "./fulfillment-section";
import { PaymentSection } from "./payment-section";
import { SummaryPanel } from "./summary-panel";
import { useCheckout } from "./use-checkout";
import { useMenuIndex } from "@/components/menu/menu-provider";

const FORM_ID = "checkout-form";

/** `/checkout`: one page, numbered sections, summary on the side. Server reads are passed in as `info`. */
export function CheckoutContent({ info }: { info: CheckoutInfo }) {
  const c = useCheckout(info.deliveryFee);
  const index = useMenuIndex();
  const router = useRouter();
  const { cart } = c;
  const empty = cart.ready && cart.count === 0;
  const bannerRef = useRef<HTMLDivElement>(null);

  // Nothing to confirm: back to the cart (not after a successful order, and not while explaining a stale cart).
  useEffect(() => {
    if (empty && !c.placed && c.unitMessages === null) router.replace("/carrito");
  }, [empty, c.placed, c.unitMessages, router]);

  // A units-invalid answer is the most important thing on the page: bring it into view.
  useEffect(() => {
    if (c.unitMessages) bannerRef.current?.scrollIntoView({ block: "center" });
  }, [c.unitMessages]);

  const showForm = cart.ready && !empty;
  const submitDisabled = c.pending || !c.ordersOpen || !cart.ready || empty;

  return (
    <div data-testid="checkout-view" data-ready={cart.ready}>
      {!showForm && c.unitMessages === null ? (
        <CheckoutSkeleton />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[1fr_24rem]">
          <div className="space-y-4">
            {c.unitMessages && (
              <div ref={bannerRef} className="scroll-mt-28">
                <UnitsInvalidBanner messages={c.unitMessages} />
              </div>
            )}
            {showForm && (
              <form
                id={FORM_ID}
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  c.submit();
                }}
                className="space-y-4"
              >
                {!c.ordersOpen && <ClosedInline hours={info.openingHoursText} />}
                <ErrorSummary errors={c.errors} other={c.other} />
                <FormMessage>{c.serverMessage}</FormMessage>
                <FulfillmentSection form={c.form} errors={c.errors} info={info} onChange={c.update} />
                <CustomerSection
                  form={c.form}
                  errors={c.errors}
                  remembered={c.remembered}
                  onChange={c.update}
                  onForget={c.forget}
                />
                <PaymentSection form={c.form} errors={c.errors} info={info} onChange={c.update} />
                {/* Honeypot: invisible to people, tempting to bots. */}
                <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden">
                  <label>
                    No completar este campo
                    <input
                      type="text"
                      name="website"
                      tabIndex={-1}
                      autoComplete="off"
                      value={c.form.website}
                      onChange={(e) => c.update({ website: e.target.value })}
                    />
                  </label>
                </div>
              </form>
            )}
          </div>
          {showForm && (
            <SummaryPanel
              groups={cart.groups.filter((g) => index.products.has(g.productId))}
              index={index}
              count={cart.count}
              preview={c.preview}
              fulfillment={c.form.fulfillment}
              submitLabel={c.pending ? "Confirmando tu pedido…" : `Confirmar pedido · ${formatARS(c.preview.total)}`}
              submitDisabled={submitDisabled}
              pending={c.pending}
              formId={FORM_ID}
            />
          )}
        </div>
      )}
    </div>
  );
}
