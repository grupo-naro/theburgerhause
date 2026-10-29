"use client";

import { useEffect, useState } from "react";
import { CopyRow } from "@/components/checkout/copy-row";
import { CheckIcon } from "@/components/menu/icons";
import { formatARS } from "@/domain/money";
import type { Fulfillment } from "@/domain/order-status";

type Props = {
  paymentMethod: "cash" | "transfer";
  paid: boolean;
  fulfillment: Fulfillment;
  total: number;
  /** Sum of add-ons still awaiting payment (0 when none). */
  pendingAddonTotal?: number;
  /** Only passed while a transfer is still to be verified. */
  bank: { alias: string; cbu: string } | null;
};

/** How the order is paid: transfer data (with the copy affordance of checkout), cash note or "verified". */
export function PaymentBlock({ paymentMethod, paid, fulfillment, total, pendingAddonTotal = 0, bank }: Props) {
  // Only the LAST copied row confirms ("¡Copiado!"), and the confirmation is announced.
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  return (
    <section
      aria-labelledby="pedido-h-pago"
      data-testid="payment-block"
      className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5"
    >
      <h2 id="pedido-h-pago" className="font-display text-xl font-extrabold text-ink">
        Pago
      </h2>
      <div className="mt-3 space-y-2">
        {paid ? (
          <p data-testid="payment-verified" className="flex items-center gap-2 font-bold text-ink">
            <span className="grid size-6 place-items-center rounded-full bg-state-ready text-white">
              <CheckIcon className="size-3.5" strokeWidth={3.5} />
            </span>
            Pago verificado
          </p>
        ) : paymentMethod === "cash" ? (
          <p data-testid="payment-cash" className="text-ink">
            Pagás en efectivo al {fulfillment === "delivery" ? "recibir" : "retirar"} tu pedido:{" "}
            <strong className="tabular-nums">{formatARS(total)}</strong>.
          </p>
        ) : (
          <div data-testid="transfer-details" className="space-y-2 rounded-2xl bg-brand-50 p-3">
            <p className="px-1 text-sm font-medium text-ink">
              Transferí <strong className="tabular-nums">{formatARS(total)}</strong> a esta cuenta. Un cajero verifica tu pago
              antes de preparar el pedido.
            </p>
            {bank && (bank.alias !== "" || bank.cbu !== "") ? (
              <>
                {bank.alias && (
                  <CopyRow
                    label="Alias"
                    value={bank.alias}
                    testId="bank-alias"
                    copied={copied === "alias"}
                    onCopied={() => setCopied("alias")}
                  />
                )}
                {bank.cbu && (
                  <CopyRow
                    label="CBU / CVU"
                    value={bank.cbu}
                    testId="bank-cbu"
                    copied={copied === "cbu"}
                    onCopied={() => setCopied("cbu")}
                  />
                )}
              </>
            ) : (
              <p className="px-1 text-sm text-ink">Te pasamos los datos de la cuenta por WhatsApp.</p>
            )}
            <p role="status" aria-live="polite" className="sr-only">
              {copied === "alias" ? "Alias copiado" : copied === "cbu" ? "CBU copiado" : ""}
            </p>
          </div>
        )}
        {paymentMethod === "transfer" && pendingAddonTotal > 0 && (
          <p data-testid="pending-addon-payment" className="rounded-2xl bg-brand-50 p-3 text-sm font-medium text-ink">
            Te falta pagar <strong className="tabular-nums">{formatARS(pendingAddonTotal)}</strong> del adicional; la vendedora te
            pasa los datos por WhatsApp.
          </p>
        )}
      </div>
    </section>
  );
}
