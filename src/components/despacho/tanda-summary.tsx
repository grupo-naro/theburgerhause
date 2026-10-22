import { MAX_TANDA_ORDERS, type TandaCount } from "@/lib/orders/tanda";

/** One chip per tanda ("Tanda 1: 2 de 3") and, when a tanda goes over the recommended max, a text warning. */
export function TandaSummary({ tandas }: { tandas: TandaCount[] }) {
  if (tandas.length === 0) return null;
  const over = tandas.filter((t) => t.overLimit);
  return (
    <div data-testid="tanda-summary" className="space-y-2">
      <ul aria-label="Resumen de tandas" className="flex flex-wrap gap-2">
        {tandas.map((t) => (
          <li
            key={t.tanda}
            data-testid="tanda-chip"
            data-over={t.overLimit ? "true" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full px-4 text-base font-bold tabular-nums ${
              t.overLimit ? "bg-cheddar-400/50 text-ink ring-2 ring-cheddar-600" : "bg-violet-100 text-violet-800"
            }`}
          >
            Tanda {t.tanda}: {t.count} de {MAX_TANDA_ORDERS}
          </li>
        ))}
      </ul>
      {over.map((t) => (
        <p key={t.tanda} role="status" data-testid="tanda-warning" className="rounded-xl bg-cheddar-400/40 px-4 py-2 text-base font-semibold text-ink">
          Tanda {t.tanda} tiene {t.count} pedidos: el máximo recomendado es {MAX_TANDA_ORDERS}
        </p>
      ))}
    </div>
  );
}
