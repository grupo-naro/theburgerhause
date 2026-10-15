import { formatARS } from "@/domain/money";
import type { CajaOrder } from "@/lib/orders/caja-queries";

type Group = CajaOrder["items"][number];

/** Chip colour from the kitchen label's shape: SIN ... (remove), + ... (add), anything else (swap). */
function modTone(label: string): string {
  if (label.startsWith("SIN")) return "bg-red-100 text-red-800 ring-red-300";
  if (label.startsWith("+")) return "bg-green-100 text-green-800 ring-green-300";
  return "bg-cheddar-400/40 text-ink ring-cheddar-600/50";
}

/** The modification as the kitchen will read it: bold, uppercase, impossible to miss. */
function ModChip({ label }: { label: string }) {
  return (
    <li
      data-testid="mod-chip"
      className={`rounded-md px-2 py-0.5 text-sm font-extrabold tracking-wide uppercase ring-1 ring-inset ${modTone(label)}`}
    >
      {label}
    </li>
  );
}

export function OrderItems({ items }: { items: Group[] }) {
  return (
    <ul className="divide-y divide-line" aria-label="Productos">
      {items.map((g, i) => (
        <li key={i} data-testid="order-line" className="py-2.5 first:pt-0 last:pb-0">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 text-lg leading-snug font-bold text-ink">
              <span className="mr-1.5 inline-block min-w-8 rounded-md bg-ink px-1.5 text-center font-display text-lg text-white tabular-nums">
                {g.quantity}×
              </span>
              {g.name}
            </p>
            <p className="shrink-0 font-semibold text-ink-muted tabular-nums">{formatARS(g.lineTotal)}</p>
          </div>
          {g.modifiers.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5 pl-10" aria-label="Modificaciones">
              {g.modifiers.map((m, j) => (
                <ModChip key={j} label={(m.kitchenLabel ?? m.name).toUpperCase()} />
              ))}
            </ul>
          )}
          {g.note && (
            <p
              data-testid="unit-note"
              className="mt-1.5 ml-10 rounded-md border-l-4 border-cheddar-600 bg-cheddar-400/20 px-2.5 py-1 text-sm font-semibold text-ink"
            >
              Nota: {g.note}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
