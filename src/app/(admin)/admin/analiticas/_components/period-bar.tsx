import Link from "next/link";
import type { Period, PeriodKind } from "@/lib/analytics/period";

/** Period selector: plain links / a GET form (no state, the URL is the source of truth). */

const TABS: { kind: Exclude<PeriodKind, "custom">; label: string }[] = [
  { kind: "hoy", label: "Hoy" },
  { kind: "semana", label: "Semana" },
  { kind: "mes", label: "Mes" },
];

const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;

export function analyticsHref(q: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) params.set(k, v);
  const s = params.toString();
  return s ? `/admin/analiticas?${s}` : "/admin/analiticas";
}

export function PeriodBar({ period, cat, right }: { period: Period; cat?: string; right: React.ReactNode }) {
  const pill = (active: boolean) =>
    `rounded-full px-4 py-2 text-sm font-semibold ${active ? "bg-brand-600 text-white" : "border border-line text-ink hover:bg-brand-50"}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Período" className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Link key={t.kind} href={analyticsHref({ p: t.kind, cat })} aria-current={period.kind === t.kind ? "page" : undefined} className={pill(period.kind === t.kind)}>
              {t.label}
            </Link>
          ))}
        </nav>
        {right}
      </div>
      <form method="get" action="/admin/analiticas" className="flex flex-wrap items-end gap-2 text-sm">
        <input type="hidden" name="p" value="custom" />
        {cat ? <input type="hidden" name="cat" value={cat} /> : null}
        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">Desde</span>
          <input type="date" name="desde" required defaultValue={period.from} className="rounded-xl border border-line bg-surface px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-muted">Hasta</span>
          <input type="date" name="hasta" required defaultValue={period.to} className="rounded-xl border border-line bg-surface px-3 py-2" />
        </label>
        <button type="submit" className={pill(period.kind === "custom")}>
          Personalizado
        </button>
        <span className="pb-2 text-ink-muted">
          {period.from === period.to ? dm(period.from) : `${dm(period.from)} al ${dm(period.to)}`} · compara con{" "}
          {period.prevFrom === period.prevTo ? dm(period.prevFrom) : `${dm(period.prevFrom)} al ${dm(period.prevTo)}`}
        </span>
      </form>
    </div>
  );
}
