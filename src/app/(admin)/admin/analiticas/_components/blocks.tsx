import { Card } from "@/components/ui/card";
import { formatARS } from "@/domain/money";
import { pctChange } from "@/lib/analytics/period";
import type { Heatmap, Kpis, SellerRow, TopProduct } from "@/lib/analytics/queries";

/**
 * The four analytics blocks. Each one has a LOCKED variant that takes names only (no number reaches
 * it, so none can reach the client) and an unlocked one with the data.
 */

const MASK = "****";
const EMPTY = "No hay ventas en este período";
const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const units = (n: number) => `${n.toLocaleString("es-AR")} u`;
const int = (n: number) => n.toLocaleString("es-AR");

function BlockTitle({ children }: { children: string }) {
  return <h2 className="font-display text-lg font-extrabold">{children}</h2>;
}

function Delta({ cur, prev, inverse = false }: { cur: number; prev: number; inverse?: boolean }) {
  const pct = pctChange(cur, prev);
  if (pct === null) return <span className="text-ink-muted">— vs período anterior</span>;
  const good = inverse ? pct <= 0 : pct >= 0;
  return (
    <span className={good ? "text-green-700" : "text-state-error"}>
      {pct >= 0 ? "▲" : "▼"} {Math.abs(pct)}% vs período anterior
    </span>
  );
}

function KpiCard({ label, value, foot }: { label: string; value: string; foot: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="font-display text-2xl font-extrabold tabular-nums">{value}</span>
      <span className="text-xs">{foot}</span>
    </Card>
  );
}

const KPI_GRID = "grid grid-cols-2 gap-3 lg:grid-cols-4";

export function KpiCards({ data }: { data: { cur: Kpis; prev: Kpis } }) {
  const { cur, prev } = data;
  return (
    <div data-testid="kpis" className={KPI_GRID}>
      <KpiCard label="Facturación" value={formatARS(cur.revenue)} foot={<Delta cur={cur.revenue} prev={prev.revenue} />} />
      <KpiCard label="Pedidos" value={int(cur.orders)} foot={<Delta cur={cur.orders} prev={prev.orders} />} />
      <KpiCard label="Ticket promedio" value={formatARS(cur.avgTicket)} foot={<Delta cur={cur.avgTicket} prev={prev.avgTicket} />} />
      <KpiCard
        label="Cancelados"
        value={int(cur.cancelledCount)}
        foot={<span className="text-ink-muted">{formatARS(cur.cancelledAmount)}</span>}
      />
    </div>
  );
}

export function LockedKpiCards() {
  const foot = <span className="text-ink-muted">**% vs período anterior</span>;
  return (
    <div data-testid="kpis" className={KPI_GRID}>
      <KpiCard label="Facturación" value={`$ ${MASK}`} foot={foot} />
      <KpiCard label="Pedidos" value={MASK} foot={foot} />
      <KpiCard label="Ticket promedio" value={`$ ${MASK}`} foot={foot} />
      <KpiCard label="Cancelados" value={MASK} foot={<span className="text-ink-muted">$ {MASK}</span>} />
    </div>
  );
}

function ProductList({ rows }: { rows: { name: string; value: string }[] }) {
  if (rows.length === 0) return <p className="text-sm text-ink-muted">{EMPTY}</p>;
  return (
    <ol className="flex flex-col">
      {rows.map((r, i) => (
        <li key={`${r.name}-${i}`} className="flex justify-between gap-3 border-b border-dashed border-line py-1.5 text-sm last:border-0">
          <span className="min-w-0 truncate">
            {i + 1}. {r.name}
          </span>
          <span className="shrink-0 tabular-nums text-ink-muted">{r.value}</span>
        </li>
      ))}
    </ol>
  );
}

export function TopProducts({ rows, filter }: { rows: TopProduct[]; filter: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BlockTitle>Top productos</BlockTitle>
        {filter}
      </div>
      <ProductList rows={rows.map((r) => ({ name: r.name, value: `${units(r.units)} · ${formatARS(r.revenue)}` }))} />
    </Card>
  );
}

export function LockedTopProducts({ names, filter }: { names: string[]; filter: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BlockTitle>Top productos</BlockTitle>
        {filter}
      </div>
      {/* Alphabetical on purpose: no ranking while locked. No position numbers either. */}
      <ul className="flex flex-col">
        {names.map((n) => (
          <li key={n} className="flex justify-between gap-3 border-b border-dashed border-line py-1.5 text-sm last:border-0">
            <span className="min-w-0 truncate">{n}</span>
            <span className="shrink-0 text-ink-muted">{MASK}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function HeatmapBlock({ data }: { data: Heatmap }) {
  const byKey = new Map(data.cells.map((c) => [`${c.dow}-${c.hour}`, c.orders]));
  const label = (h: number) => String(h).padStart(2, "0");
  return (
    <Card className="flex flex-col gap-3">
      <BlockTitle>Día × hora</BlockTitle>
      {data.hours.length === 0 ? (
        <p className="text-sm text-ink-muted">{EMPTY}</p>
      ) : (
        <div className="overflow-x-auto">
          <div
            className="grid min-w-max gap-0.5 text-[11px]"
            style={{ gridTemplateColumns: `2.5rem repeat(${data.hours.length}, minmax(1.75rem, 1fr))` }}
          >
            <span />
            {data.hours.map((h) => (
              <span key={h} className="text-center text-ink-muted">
                {label(h)}
              </span>
            ))}
            {DAYS.map((day, i) => (
              <Row key={day} day={day} dow={i + 1} hours={data.hours} byKey={byKey} max={data.max} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function Row({ day, dow, hours, byKey, max }: { day: string; dow: number; hours: number[]; byKey: Map<string, number>; max: number }) {
  return (
    <>
      <span className="self-center text-ink-muted">{day}</span>
      {hours.map((h) => {
        const n = byKey.get(`${dow}-${h}`) ?? 0;
        const text = `${day} ${String(h).padStart(2, "0")} h: ${n} ${n === 1 ? "pedido" : "pedidos"}`;
        return (
          <span
            key={h}
            title={text}
            aria-label={text}
            role="img"
            className="h-6 rounded-sm bg-brand-600"
            style={{ opacity: n === 0 ? 0.06 : 0.15 + 0.85 * (n / max) }}
          />
        );
      })}
    </>
  );
}

export function LockedHeatmap() {
  return (
    <Card className="flex flex-col gap-3">
      <BlockTitle>Día × hora</BlockTitle>
      <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-line text-sm text-ink-muted">Mapa oculto</div>
    </Card>
  );
}

const TH = "px-2 py-1.5 text-left font-semibold text-ink-muted";
const TD = "px-2 py-1.5 tabular-nums";
const HEAD = ["Nombre", "Pedidos", "Facturación", "Ticket prom.", "Adicionales"];

function SellersFrame({ children, empty }: { children: React.ReactNode; empty: boolean }) {
  return (
    <Card className="flex flex-col gap-3">
      <BlockTitle>Vendedoras</BlockTitle>
      {empty ? (
        <p className="text-sm text-ink-muted">{EMPTY}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-line">
                {HEAD.map((h) => (
                  <th key={h} className={TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function SellersTable({ rows }: { rows: SellerRow[] }) {
  return (
    <SellersFrame empty={rows.length === 0}>
      {rows.map((r) => (
        <tr key={r.userId ?? "none"} className="border-b border-dashed border-line last:border-0">
          <td className="px-2 py-1.5">{r.name}</td>
          <td className={TD}>{int(r.orders)}</td>
          <td className={TD}>{formatARS(r.revenue)}</td>
          <td className={TD}>{formatARS(r.avgTicket)}</td>
          <td className={TD}>{int(r.addons)}</td>
        </tr>
      ))}
    </SellersFrame>
  );
}

export function LockedSellersTable({ names }: { names: string[] }) {
  return (
    <SellersFrame empty={names.length === 0}>
      {names.map((n) => (
        <tr key={n} className="border-b border-dashed border-line last:border-0">
          <td className="px-2 py-1.5">{n}</td>
          <td className={TD}>{MASK}</td>
          <td className={TD}>$ {MASK}</td>
          <td className={TD}>$ {MASK}</td>
          <td className={TD}>{MASK}</td>
        </tr>
      ))}
    </SellersFrame>
  );
}
