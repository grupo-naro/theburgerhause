"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCart } from "@/components/cart/cart-provider";
import { ChevronDownIcon } from "@/components/menu/icons";
import { useToast } from "@/components/ui/toast";
import { formatARS } from "@/domain/money";
import { signature } from "@/lib/cart/signature";
import { resolveEditSubmit } from "@/lib/cart/sheet-state";
import type { CartGroup, UnitConfig } from "@/lib/cart/types";
import type { PublicProduct } from "@/lib/menu/public";
import type { ActivePager } from "@/lib/orders/pagers";
import { PLAIN_UNIT } from "@/lib/pos/fast-path";
import { CatalogPanel } from "./catalog-panel";
import { ConfigureDialog, type ConfigureRequest } from "./configure-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import { ConfirmationOverlay } from "./confirmation-overlay";
import { TicketPanel } from "./ticket-panel";
import { useCounterSale } from "./use-counter-sale";
import { usePagers } from "./use-pagers";
import { usePosShortcuts } from "./use-pos-shortcuts";

type Props = { initialPagers: ActivePager[]; stationId: number | null };

const MAX_MESSAGE = "El ticket llegó al máximo de unidades.";

/**
 * The POS screen: catalog on the left, ticket on the right (a slide-over below 1024 px). It owns the
 * UI state (dialogs, drawer, +1 pulses) and wires the pure logic in lib/pos to the components; the
 * ticket contents live in the POS cart (CartProvider with a per-station storage key).
 */
export function PosBoard({ initialPagers, stationId }: Props) {
  const cart = useCart();
  const toast = useToast();
  const { pagers, refresh } = usePagers(initialPagers);
  const sale = useCounterSale({ pagers, refreshPagers: refresh, stationId });

  const searchRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [configure, setConfigure] = useState<ConfigureRequest | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pulses, setPulses] = useState<Record<number, number>>({});
  const [flash, setFlash] = useState<{ signature: string; nonce: number } | null>(null);
  const nonce = useRef(0);

  const modalOpen = configure !== null || confirmClear || sale.confirmation !== null;

  // Give the focus back to whoever opened a dialog (or to the search box when it is gone).
  const restoreFocus = useCallback(() => {
    const el = opener.current;
    opener.current = null;
    requestAnimationFrame(() => {
      if (el?.isConnected) el.focus({ preventScroll: true });
      else searchRef.current?.focus({ preventScroll: true });
    });
  }, []);

  function addPlain(product: PublicProduct) {
    if (sale.soldOut.has(product.id)) return;
    if (!cart.add(product.id, [PLAIN_UNIT])) {
      toast.show({ message: MAX_MESSAGE });
      return;
    }
    nonce.current += 1;
    const n = nonce.current;
    setPulses((p) => ({ ...p, [product.id]: n }));
    setFlash({ signature: signature({ productId: product.id, ...PLAIN_UNIT }), nonce: n });
  }

  function openConfigure(request: ConfigureRequest, from: HTMLElement | null) {
    opener.current = from ?? (document.activeElement as HTMLElement | null);
    setConfigure(request);
  }

  function confirmConfigure(productId: number, units: UnitConfig[]) {
    const editSignature = configure?.editGroup?.signature;
    const replace = editSignature !== undefined && resolveEditSubmit(cart.groups, editSignature) === "replace";
    const ok = replace && editSignature ? (cart.replaceGroup(editSignature, productId, units), true) : cart.add(productId, units);
    if (!ok) {
      toast.show({ message: MAX_MESSAGE });
      return;
    }
    setConfigure(null);
    restoreFocus();
  }

  function removeGroup(group: CartGroup) {
    cart.removeGroup(group.signature);
    toast.show({ message: "Producto quitado del ticket", action: { label: "Deshacer", onClick: () => cart.undoRemoval() } });
  }

  function setQuantity(sig: string, quantity: number) {
    const group = cart.groups.find((g) => g.signature === sig);
    if (group && quantity < 1) removeGroup(group);
    else cart.setGroupQuantity(sig, quantity);
  }

  function requestClear() {
    if (cart.count === 0 || sale.busy) return;
    opener.current = document.activeElement as HTMLElement | null;
    setConfirmClear(true);
  }

  function charge() {
    if (!sale.charge.canCharge) {
      if (!sale.busy && sale.charge.reason) toast.show({ message: sale.charge.reason });
      return;
    }
    sale.submit();
  }

  usePosShortcuts(
    {
      search: () => {
        setDrawerOpen(false);
        searchRef.current?.focus();
        searchRef.current?.select();
      },
      charge,
      clear: requestClear,
    },
    !modalOpen,
  );

  // A slide-over left open must not survive a resize to the two-column layout (the catalog would stay inert).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => mq.matches && setDrawerOpen(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Slide-over: Esc closes it, focus moves in on open and back to the bar on close.
  useEffect(() => {
    if (!drawerOpen) return;
    drawerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !modalOpen) {
        setDrawerOpen(false);
        requestAnimationFrame(() => barRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, modalOpen]);

  return (
    <div className="max-lg:pb-24">
      <div
        data-testid="pos-board"
        data-ready={cart.ready}
        className="lg:grid lg:h-[calc(100dvh-12rem)] xl:h-[calc(100dvh-8.5rem)] lg:group-has-[[data-testid=stock-alert]]/shell:h-[calc(100dvh-16rem)] lg:group-has-[[data-testid=stock-alert]]/shell:min-h-[30rem] xl:group-has-[[data-testid=stock-alert]]/shell:h-[calc(100dvh-12.5rem)] lg:group-has-[[data-testid=pending-app-banner]]/shell:h-[calc(100dvh-18rem)] lg:group-has-[[data-testid=pending-app-banner]]/shell:min-h-[28rem] xl:group-has-[[data-testid=pending-app-banner]]/shell:h-[calc(100dvh-14.5rem)] lg:group-has-[[data-testid=pending-app-banner]]/shell:group-has-[[data-testid=stock-alert]]/shell:h-[calc(100dvh-22rem)] lg:group-has-[[data-testid=pending-app-banner]]/shell:group-has-[[data-testid=stock-alert]]/shell:min-h-[24rem] xl:group-has-[[data-testid=pending-app-banner]]/shell:group-has-[[data-testid=stock-alert]]/shell:h-[calc(100dvh-18.5rem)] lg:min-h-[34rem] lg:grid-cols-[minmax(0,1fr)_clamp(19.5rem,37%,26.5rem)] lg:gap-5"
      >
        <div className="contents" inert={drawerOpen}>
        <CatalogPanel
          searchRef={searchRef}
          pulses={pulses}
          onAdd={addPlain}
          onCustomize={(product, from) => {
            if (!sale.soldOut.has(product.id)) openConfigure({ productId: product.id }, from);
          }}
          soldOut={sale.soldOut}
        />
        </div>

        {drawerOpen && (
          <div data-testid="ticket-backdrop" aria-hidden="true" onClick={() => setDrawerOpen(false)} className="fixed inset-0 z-30 bg-ink/50 lg:hidden" />
        )}
        <aside
          ref={drawerRef}
          tabIndex={-1}
          id="ticket-drawer"
          aria-label="Ticket"
          data-testid="ticket-aside"
          data-open={drawerOpen}
          className={`min-h-0 outline-none lg:static lg:h-full max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-[min(27rem,100vw)] max-lg:bg-bg max-lg:p-2 max-lg:shadow-2xl ${
            drawerOpen ? "max-lg:animate-[pos-slide-in_0.2s_ease-out]" : "max-lg:invisible max-lg:translate-x-full"
          }`}
        >
          <TicketPanel
            sale={sale}
            pagers={pagers}
            flash={flash}
            onQuantity={setQuantity}
            onEdit={(group, from) => openConfigure({ productId: group.productId, editGroup: group }, from)}
            onRemove={removeGroup}
            onClear={requestClear}
            onCloseDrawer={() => {
              setDrawerOpen(false);
              requestAnimationFrame(() => barRef.current?.focus());
            }}
          />
        </aside>
      </div>

      <div inert={drawerOpen} className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 p-3 backdrop-blur lg:hidden">
        <button
          ref={barRef}
          type="button"
          data-testid="ticket-bar"
          aria-expanded={drawerOpen}
          aria-controls="ticket-drawer"
          onClick={() => setDrawerOpen(true)}
          className="flex min-h-14 w-full items-center justify-between rounded-full bg-brand-600 px-6 font-display text-lg font-extrabold text-white shadow-md active:bg-brand-700"
        >
          <span>
            Ticket · <span data-testid="bar-count">{cart.count}</span>
          </span>
          <span className="flex items-center gap-2">
            <span data-testid="bar-total" className="tabular-nums">{formatARS(sale.totals.total)}</span>
            <ChevronDownIcon className="size-5 rotate-180" />
          </span>
        </button>
      </div>

      {configure && (
        <ConfigureDialog
          key={configure.editGroup?.signature ?? `new-${configure.productId}`}
          request={configure}
          onConfirm={confirmConfigure}
          onClose={() => {
            setConfigure(null);
            restoreFocus();
          }}
        />
      )}
      {confirmClear && (
        <ConfirmDialog
          title="¿Limpiar el ticket?"
          body={`Se quitan ${cart.count} ${cart.count === 1 ? "unidad" : "unidades"} del ticket.`}
          confirmLabel="Limpiar"
          onConfirm={() => {
            cart.clear();
            setConfirmClear(false);
            restoreFocus();
          }}
          onCancel={() => {
            setConfirmClear(false);
            restoreFocus();
          }}
        />
      )}
      {sale.confirmation && (
        <ConfirmationOverlay
          key={sale.confirmation.orderId}
          sale={sale.confirmation}
          onNewSale={() => {
            sale.newSale();
            setDrawerOpen(false);
            opener.current = null;
            restoreFocus();
          }}
        />
      )}
    </div>
  );
}
