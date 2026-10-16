"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertIcon, ReceiptIcon } from "./pos-icons";
import { CloseIcon } from "@/components/menu/icons";
import { useCart } from "@/components/cart/cart-provider";
import { useMenuIndex } from "@/components/menu/menu-provider";
import { issueMessages } from "@/lib/cart/display";
import type { CartGroup } from "@/lib/cart/types";
import { ChargeFooter } from "./charge-footer";
import { PagerSection } from "./pager-section";
import { PaymentSection } from "./payment-section";
import { TicketLines } from "./ticket-lines";
import type { useCounterSale } from "./use-counter-sale";
import type { ActivePager } from "@/lib/orders/pagers";

type Sale = ReturnType<typeof useCounterSale>;

type Props = {
  sale: Sale;
  pagers: ActivePager[];
  flash: { signature: string; nonce: number } | null;
  onQuantity: (signature: string, quantity: number) => void;
  onEdit: (group: CartGroup, opener: HTMLElement) => void;
  onRemove: (group: CartGroup) => void;
  onClear: () => void;
  /** Slide-over mode: renders a close button. */
  onCloseDrawer?: () => void;
};

function Banner({ tone, children, onDismiss }: { tone: "error" | "warn"; children: ReactNode; onDismiss?: () => void }) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-base font-semibold ${
        tone === "error" ? "bg-red-50 text-state-error ring-1 ring-red-200" : "bg-cheddar-400/25 text-ink ring-1 ring-cheddar-600/40"
      }`}
    >
      <AlertIcon className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Cerrar aviso" className="-m-2 grid size-12 shrink-0 place-items-center rounded-full hover:bg-black/5">
          <CloseIcon className="size-5" />
        </button>
      )}
    </div>
  );
}

/** The right panel: ticket lines, payment, pager, optional name and the always-visible charge footer. */
export function TicketPanel({ sale, pagers, flash, onQuantity, onEdit, onRemove, onClear, onCloseDrawer }: Props) {
  const cart = useCart();
  const index = useMenuIndex();
  const issues = issueMessages(cart.issues, index);

  return (
    <div data-testid="ticket-panel" className="@container/ticket flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
        <h2 className="flex-1 font-display text-2xl font-extrabold text-ink">
          Ticket
          <span data-testid="ticket-count" className="ml-2 rounded-full bg-brand-50 px-2.5 py-0.5 align-middle text-base font-bold text-brand-700">
            {cart.count}
          </span>
        </h2>
        <button
          type="button"
          data-testid="clear-ticket"
          disabled={cart.count === 0}
          onClick={onClear}
          aria-keyshortcuts="Alt+L"
          className="min-h-12 rounded-full px-4 text-base font-bold text-state-error hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Limpiar ticket
        </button>
        {onCloseDrawer && (
          <button
            type="button"
            onClick={onCloseDrawer}
            aria-label="Cerrar ticket"
            className="grid size-12 lg:hidden shrink-0 place-items-center rounded-full ring-1 ring-line hover:bg-brand-50"
          >
            <CloseIcon className="size-5" />
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3 [scrollbar-width:thin]">
        {sale.unitMessages && (
          <Banner tone="warn" onDismiss={sale.dismissUnitMessages}>
            <div data-testid="unit-issues">
              <p>Algunos productos ya no están disponibles. Los quitamos del ticket:</p>
              <ul className="mt-1 list-disc pl-5 font-medium">
                {sale.unitMessages.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          </Banner>
        )}
        {issues.length > 0 && (
          <Banner tone="warn" onDismiss={cart.dismissIssues}>
            <ul data-testid="cart-issues" className="font-medium">
              {issues.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Banner>
        )}
        {sale.stationMissing && (
          <Banner tone="error">
            <p data-testid="station-required">Falta elegir la estación para imprimir.</p>
            <Link href="/estacion?next=/mostrador" className="mt-1 inline-flex min-h-12 items-center font-bold underline underline-offset-4">
              Elegir estación
            </Link>
          </Banner>
        )}
        {sale.message && (
          <Banner tone="error">
            <p data-testid="sale-error">{sale.message}</p>
          </Banner>
        )}

        {cart.groups.length === 0 ? (
          <div data-testid="ticket-empty" className="flex items-center gap-3 rounded-2xl border border-dashed border-line bg-bg px-4 py-3">
            <ReceiptIcon className="size-9 shrink-0 text-brand-300" />
            <div className="text-left">
              <p className="font-display text-lg leading-tight font-bold text-ink">Ticket vacío</p>
              <p className="text-base leading-tight text-ink-muted">Tocá un producto para agregarlo.</p>
            </div>
          </div>
        ) : (
          <TicketLines groups={cart.groups} flash={flash} onQuantity={onQuantity} onEdit={onEdit} onRemove={onRemove} />
        )}

        <PaymentSection
          payment={sale.payment}
          onPayment={sale.choosePayment}
          totalCents={sale.totals.total}
          receivedText={sale.receivedText}
          onReceivedText={sale.setReceivedText}
        />

        <PagerSection
          text={sale.pagerText}
          value={sale.pager}
          conflict={sale.conflict}
          active={pagers}
          nextFree={sale.nextFree}
          onKey={sale.typePagerKey}
          onText={sale.typePagerText}
          onNextFree={sale.pickNextFree}
        />

        <div>
          <label htmlFor="pos-customer-name" className="mb-1 block font-display text-base font-extrabold tracking-wide text-ink-muted uppercase">
            Nombre <span className="font-sans text-sm font-semibold tracking-normal normal-case">(opcional)</span>
          </label>
          <input
            id="pos-customer-name"
            value={sale.name}
            maxLength={80}
            autoComplete="off"
            onChange={(e) => sale.setName(e.target.value)}
            placeholder="Ej.: Ana"
            data-testid="customer-name"
            className="min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-lg"
          />
        </div>
      </div>

      <ChargeFooter total={sale.totals.total} charge={sale.charge} change={sale.change} busy={sale.busy} onCharge={sale.submit} />
    </div>
  );
}
