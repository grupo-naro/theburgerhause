import Link from "next/link";
import { formatMoney } from "@/lib/rendicion/shortage";
import { formatSettledAt, pluralOrders } from "@/lib/rendicion/receipt";
import type { CadetBalance } from "@/lib/settlements/queries";

const phoneHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

function CadetCard({ c, now }: { c: CadetBalance; now: Date }) {
  const owes = c.owed > 0;
  return (
    <li
      data-testid="cadet-balance"
      data-cadet-id={c.cadetId}
      className={`relative flex min-h-48 flex-col rounded-2xl border-2 p-5 transition-shadow focus-within:shadow-lg hover:shadow-md ${
        owes ? "border-cheddar-600 bg-surface" : "border-line bg-surface"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl leading-tight font-extrabold break-words">
            <Link
              href={`/despacho/rendicion?cadet=${c.cadetId}`}
              data-testid="cadet-open"
              className="rounded-md after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-offset-4"
            >
              {c.name}
            </Link>
          </h2>
          {c.phone && (
            <a href={phoneHref(c.phone)} className="relative z-10 mt-0.5 inline-flex min-h-12 items-center text-base font-semibold text-brand-600 underline underline-offset-4">
              {c.phone}
            </a>
          )}
        </div>
        {!c.active && (
          <span data-testid="inactive-tag" className="shrink-0 rounded-full bg-slate-200 px-3 py-1 text-sm font-bold text-slate-700">
            Inactivo
          </span>
        )}
      </div>

      <div className="mt-3">
        {owes ? (
          <>
            <p className="text-base font-bold text-ink-muted">Debe rendir</p>
            <p data-testid="cadet-owed" className="font-display text-5xl leading-none font-extrabold tracking-tight text-ink tabular-nums">
              {formatMoney(c.owed)}
            </p>
            <p data-testid="cadet-owed-count" className="mt-1.5 text-base font-semibold">
              {pluralOrders(c.owedOrderCount)} en efectivo
            </p>
          </>
        ) : (
          <p data-testid="cadet-owed" className="inline-flex items-center gap-2 rounded-full bg-green-100 px-4 py-2 font-display text-2xl font-extrabold text-green-800">
            <span aria-hidden>✓</span> Al día
          </p>
        )}
      </div>

      <div className="mt-auto space-y-1 pt-4 text-base">
        {c.inRouteCount > 0 && (
          <p data-testid="cadet-inroute" className="font-medium text-ink-muted">
            {c.inRouteCount} en ruta{c.inRouteCash > 0 ? ` · ${formatMoney(c.inRouteCash)} todavía en la calle` : ""}
          </p>
        )}
        <p className="text-ink-muted">
          Última rendición: <span data-testid="cadet-last">{formatSettledAt(c.lastSettlementAt, now)}</span>
        </p>
        {c.shortageTotal > 0 && (
          <p data-testid="cadet-shortage" className="inline-block rounded-full bg-red-100 px-3 py-1 text-sm font-bold text-red-800">
            Faltantes acumulados {formatMoney(c.shortageTotal)}
          </p>
        )}
      </div>
    </li>
  );
}

/** List view: totals strip + one card per cadet, most debt first (the query already sorts). */
export function BalanceList({ balances, now }: { balances: CadetBalance[]; now: Date }) {
  const total = balances.reduce((sum, c) => sum + c.owed, 0);
  const debtors = balances.filter((c) => c.owed > 0).length;
  return (
    <div data-testid="rendicion-list" className="space-y-5">
      <section
        aria-label="Total pendiente"
        className={`flex flex-wrap items-end justify-between gap-x-8 gap-y-2 rounded-2xl px-6 py-5 ${total > 0 ? "bg-ink text-white" : "bg-green-100 text-green-900"}`}
      >
        <div>
          <p className="text-base font-bold opacity-80">Efectivo pendiente de rendir</p>
          <p data-testid="total-pending" className="font-display text-5xl leading-none font-extrabold tabular-nums">
            {formatMoney(total)}
          </p>
        </div>
        <p data-testid="total-debtors" className="text-lg font-semibold">
          {debtors === 0 ? "Nadie debe rendir ahora" : `${debtors} ${debtors === 1 ? "cadete debe" : "cadetes deben"} rendir`}
        </p>
      </section>

      {balances.length === 0 ? (
        <p data-testid="rendicion-empty" className="rounded-2xl border border-line bg-surface px-6 py-10 text-center text-lg text-ink-muted">
          No hay cadetes activos. Cargalos desde Administración.
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {balances.map((c) => (
            <CadetCard key={c.cadetId} c={c} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}
