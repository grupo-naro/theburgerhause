"use client";

import { CheckIcon } from "@/components/menu/icons";
import type { ActivePager } from "@/lib/orders/pagers";
import type { PagerKey } from "@/lib/pos/pager-keypad";
import { BackspaceIcon } from "./pos-icons";

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

/**
 * Pager number. The typed value, its status and "Siguiente libre" are PINNED (sticky) while the
 * keypad is on screen, so they are always visible next to the keys; the in-use badges are one
 * compact row right above them (never down at the bottom, under the footer). In a wide ticket the
 * keypad sits beside the pinned block; in a narrow one the pinned block goes above the keypad.
 */
export function PagerSection({ text, value, conflict, active, nextFree, onKey, onText, onNextFree }: Props) {
  const typed = value !== null;
  return (
    <section aria-labelledby="pos-pager-h" data-testid="pager-section">
      <h3 id="pos-pager-h" className="mb-1.5 font-display text-base font-extrabold tracking-wide text-ink-muted uppercase">
        Llamador <span className="font-sans text-sm font-semibold tracking-normal normal-case">(obligatorio)</span>
      </h3>

      <div data-testid="pagers-in-use" className="mb-2 flex items-center gap-2">
        <p className="shrink-0 text-sm font-semibold text-ink-muted">En uso</p>
        {active.length === 0 ? (
          <p className="text-sm text-ink-muted">Ningún llamador en uso.</p>
        ) : (
          <ul className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
            {active.map((p) => (
              <li
                key={p.pagerNumber}
                data-testid="pager-badge"
                data-pager={p.pagerNumber}
                title={`Llamador ${p.pagerNumber} en uso por el pedido #${p.orderNumber}`}
                className={`inline-flex shrink-0 items-baseline gap-1 rounded-lg px-2.5 py-1 ${
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

      <div className="grid grid-cols-1 gap-x-3 gap-y-2 @[22rem]/ticket:grid-cols-[11.5rem_1fr]">
        <div
          data-testid="pager-pinned"
          className="sticky top-0 z-10 grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 bg-surface pb-1 @[22rem]/ticket:col-start-2 @[22rem]/ticket:row-start-1 @[22rem]/ticket:grid-cols-1 @[22rem]/ticket:self-start"
        >
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
            className={`h-14 w-full min-w-0 rounded-2xl border-2 bg-surface text-center font-display text-4xl leading-none font-extrabold tabular-nums ${
              conflict ? "border-state-error text-state-error" : typed ? "border-state-ready text-ink" : "border-line text-ink"
            }`}
          />
          <button
            type="button"
            data-testid="pager-next-free"
            disabled={nextFree === null}
            onClick={onNextFree}
            className="min-h-12 rounded-xl border-2 border-brand-600 bg-brand-50 px-2 font-display text-base leading-tight font-bold text-brand-700 transition-colors hover:bg-brand-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 @[22rem]/ticket:order-last"
          >
            Siguiente libre
            {nextFree !== null && <span className="block text-lg font-extrabold tabular-nums">N° {nextFree}</span>}
          </button>
          <p
            role={conflict ? "alert" : undefined}
            data-testid="pager-status"
            className={`col-span-2 min-h-5 text-sm leading-tight font-bold @[22rem]/ticket:col-span-1 ${
              conflict ? "text-state-error" : typed ? "text-ink" : "text-ink-muted"
            }`}
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
        </div>
        <div
          role="group"
          aria-label="Teclado del llamador"
          className="grid w-full grid-cols-3 gap-2 @[22rem]/ticket:col-start-1 @[22rem]/ticket:row-start-1"
        >
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
      </div>
    </section>
  );
}
