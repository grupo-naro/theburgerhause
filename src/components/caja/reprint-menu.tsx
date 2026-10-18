"use client";

import { useEffect, useRef, useState } from "react";
import { reprintOrderAction } from "@/app/(staff)/caja/actions";
import { useGuardedAction } from "./use-guarded-action";

const CUSTOMER = { which: "customer", label: "Ticket cliente", sent: "ticket cliente" } as const;
const DELIVERY = { which: "delivery", label: "Ticket delivery", sent: "ticket delivery" } as const;
const BOTH = { which: "both", label: "Ambos tickets", sent: "ambos tickets" } as const;

/** "Reimprimir" disclosure: pick what to print again at THIS station. */
export function ReprintMenu({
  orderId,
  orderNumber,
  hasDeliveryTicket,
}: {
  orderId: number;
  orderNumber: number;
  /** Delivery orders also have the dispatch ticket; every other order only has the customer ticket. */
  hasDeliveryTicket: boolean;
}) {
  const options = hasDeliveryTicket ? [CUSTOMER, DELIVERY, BOTH] : [CUSTOMER];
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const { run, pending, error } = useGuardedAction();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative ml-auto">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        disabled={pending}
        aria-label={`Reimprimir pedido #${orderNumber}`}
        onClick={() => setOpen((o) => !o)}
        className="min-h-12 rounded-full border border-line bg-surface px-5 font-bold text-ink hover:bg-brand-50 disabled:opacity-60"
      >
        {pending ? "Enviando…" : "Reimprimir"}
      </button>
      {open && (
        <div role="group" aria-label="Qué reimprimir" className="absolute right-0 z-20 mt-2 w-52 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          {options.map((o) => (
            <button
              key={o.which}
              type="button"
              onClick={() => {
                setOpen(false);
                setDone(null);
                run(() => reprintOrderAction({ orderId, which: o.which }), {
                  onOk: () => setDone(`Enviado a imprimir (${o.sent})`),
                });
              }}
              className="flex min-h-12 w-full items-center rounded-lg px-3 text-left text-base font-semibold text-ink hover:bg-brand-50"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <p role="status" className="absolute right-0 mt-1 text-xs font-semibold whitespace-nowrap text-green-700">
        {done}
      </p>
      {error && (
        <p role="alert" className="absolute right-0 mt-1 text-xs font-semibold whitespace-nowrap text-state-error">
          {error}
        </p>
      )}
    </div>
  );
}
