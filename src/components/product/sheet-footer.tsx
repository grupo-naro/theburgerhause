import { formatARS } from "@/domain/money";

type Props = {
  total: number;
  mode: "add" | "edit";
  closed: boolean;
  busy: boolean;
  /** Error / closed message shown above the button. */
  message: string | null;
  onSubmit: () => void;
};

/** Sticky footer: message + the cheddar CTA with the live total (announced politely). */
export function SheetFooter({ total, mode, closed, busy, message, onSubmit }: Props) {
  const price = formatARS(total);
  const label = mode === "edit" ? "Guardar cambios" : "Agregar al pedido";
  return (
    <div className="shrink-0 border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-6px_16px_rgba(11,31,58,0.06)]">
      {(closed || message) && (
        <p
          role="alert"
          data-testid="sheet-message"
          className="mb-2 rounded-xl bg-cheddar-400/25 px-3 py-2 text-sm font-medium leading-snug text-ink"
        >
          {closed ? "Por el momento no estamos tomando pedidos." : message}
        </p>
      )}
      <button
        type="button"
        onClick={onSubmit}
        disabled={closed || busy}
        data-testid="sheet-cta"
        className="flex min-h-14 w-full items-center justify-center rounded-full bg-cheddar-400 px-6 font-display text-lg font-extrabold text-ink shadow-sm transition-colors hover:bg-cheddar-600 active:bg-cheddar-600 disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-muted disabled:shadow-none"
      >
        {closed ? "Pedidos pausados" : `${label} · ${price}`}
      </button>
      <span aria-live="polite" className="sr-only">
        Total {price}
      </span>
    </div>
  );
}
