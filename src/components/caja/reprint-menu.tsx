"use client";

import { useEffect, useRef, useState } from "react";
import { reprintOrderAction } from "@/app/(staff)/caja/actions";
import { useGuardedAction } from "./use-guarded-action";

const OPTIONS = [
  { which: "kitchen", label: "Cocina" },
  { which: "ticket", label: "Ticket" },
  { which: "both", label: "Ambas" },
] as const;

/** "Reimprimir" disclosure: pick what to print again at THIS station. */
export function ReprintMenu({ orderId, orderNumber }: { orderId: number; orderNumber: number }) {
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
    <div ref={root} className="relative">
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
        <div role="group" aria-label="Qué reimprimir" className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          {OPTIONS.map((o) => (
            <button
              key={o.which}
              type="button"
              onClick={() => {
                setOpen(false);
                setDone(null);
                run(() => reprintOrderAction({ orderId, which: o.which }), {
                  onOk: () => setDone(`Enviado a imprimir (${o.label.toLowerCase()})`),
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
