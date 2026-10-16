"use client";

import { BackspaceIcon } from "./pos-icons";
import { CheckIcon } from "@/components/menu/icons";
import type { ActivePager } from "@/lib/orders/pagers";
import type { PagerKey } from "@/lib/pos/pager-keypad";

type Props = {
  text: string;
  /** Valid typed pager (1..999) or null. */
  value: number | null;
  /** Conflict text ("Llamador 7 en uso por el pedido #23") or null. */
  conflict: string | null;
  active: ActivePager[];
  nextFree: number | null;
  onKey: (key: PagerKey) => void;
  onText: (text: string) => void;
  onNextFree: () => void;
};

const KEYS: { key: PagerKey; label: string }[] = [
  ...(["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const).map((k) => ({ key: k as PagerKey, label: k })),
  { key: "clear", label: "C" },
  { key: "0", label: "0" },
  { key: "back", label: "⌫" },
];

/** Pager number: on-screen keypad (also typeable), live conflict feedback, "Siguiente libre" and the numbers in use. */
export function PagerSection({ text, value, conflict, active, nextFree, onKey, onText, onNextFree }: Props) {
  const typed = value !== null;
  return (
    <section aria-labelledby="pos-pager-h" data-testid="pager-section">
      <h3 id="pos-pager-h" className="mb-2 font-display text-base font-extrabold tracking-wide text-ink-muted uppercase">
        Llamador <span className="font-sans text-sm font-semibold tracking-normal normal-case">(obligatorio)</span>
      </h3>
      <div className="grid grid-cols-1 gap-3 @[22rem]/ticket:grid-cols-[auto_1fr]">
        <div role="group" aria-label="Teclado del llamador" className="grid w-full grid-cols-3 gap-2 @[22rem]/ticket:col-start-1 @[22rem]/ticket:row-start-1 @[22rem]/ticket:w-[11.5rem]">
          {KEYS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              data-testid={`pager-key-${key}`}
              aria-label={key === "back" ? "Borrar último dígito" : key === "clear" ? "Borrar todo" : label}
              onClick={() => onKey(key)}
              className={`grid h-12 place-items-center rounded-xl font-display text-2xl font-extrabold transition-colors active:scale-95 ${
                key === "clear" || key === "back"
                  ? "bg-bg text-ink-muted ring-1 ring-line hover:bg-brand-50"
                  : "bg-surface text-ink ring-1 ring-line hover:bg-brand-50 active:bg-brand-50"
              }`}
            >
              {key === "back" ? <BackspaceIcon className="size-6" /> : label}
            </button>
          ))}
        </div>
        <div className="order-first flex min-w-0 flex-col gap-2 @[22rem]/ticket:order-none @[22rem]/ticket:col-start-2 @[22rem]/ticket:row-start-1">
          <input
            inputMode="numeric"
            autoComplete="off"
            aria-label="Número de llamador"
            aria-invalid={conflict ? true : undefined}
            value={text}
            placeholder="—"
            maxLength={3}
            onChange={(e) => onText(e.target.value)}
            data-testid="pager-input"
            className={`h-16 w-full rounded-2xl border-2 bg-surface text-center font-display text-5xl leading-none font-extrabold tabular-nums ${
              conflict ? "border-state-error text-state-error" : typed ? "border-state-ready text-ink" : "border-line text-ink"
            }`}
          />
          <p
            role={conflict ? "alert" : undefined}
            data-testid="pager-status"
            className={`min-h-10 text-sm leading-tight font-bold ${conflict ? "text-state-error" : typed ? "text-ink" : "text-ink-muted"}`}
          >
            {conflict ? (
              conflict
            ) : typed ? (
              <span className="inline-flex items-center gap-1">
                <CheckIcon className="size-4 text-state-ready" strokeWidth={3} />
                Llamador {value} libre
              </span>
            ) : (
              "Tocá los números o escribilo"
            )}
          </p>
          <button
            type="button"
            data-testid="pager-next-free"
            disabled={nextFree === null}
            onClick={onNextFree}
            className="min-h-12 rounded-xl border-2 border-brand-600 bg-brand-50 px-2 font-display text-base font-bold text-brand-700 transition-colors hover:bg-brand-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Siguiente libre
            {nextFree !== null && <span className="block text-lg leading-tight font-extrabold tabular-nums">N° {nextFree}</span>}
          </button>
        </div>
      </div>

      <div className="mt-3" data-testid="pagers-in-use">
        <p className="mb-1.5 text-sm font-semibold text-ink-muted">En uso ahora</p>
        {active.length === 0 ? (
          <p className="text-sm text-ink-muted">Ningún llamador en uso.</p>
        ) : (
          <ul className="flex max-h-[5.5rem] flex-wrap gap-1.5 overflow-y-auto">
            {active.map((p) => (
              <li
                key={p.pagerNumber}
                data-testid="pager-badge"
                data-pager={p.pagerNumber}
                title={`Llamador ${p.pagerNumber} en uso por el pedido #${p.orderNumber}`}
                className={`inline-flex items-baseline gap-1 rounded-lg px-2.5 py-1 ${
                  p.pagerNumber === value ? "bg-state-error text-white" : "bg-ink text-white"
                }`}
              >
                <span className="font-display text-lg leading-none font-extrabold tabular-nums">{p.pagerNumber}</span>
                <span className="text-xs font-semibold text-white/80 tabular-nums">#{p.orderNumber}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
