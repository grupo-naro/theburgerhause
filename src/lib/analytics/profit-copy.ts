import { formatARS } from "@/domain/money";

/** Texts for the profit shown in Analíticas (spec 2026-11-17). Pure. */

/** "gana $X" / "gana $X · N sin costo" / "sin costo". */
export function productProfitText(r: { profit: number | null; uncostedUnits: number }): string {
  if (r.profit === null) return "sin costo";
  const base = `gana ${formatARS(r.profit)}`;
  return r.uncostedUnits > 0 ? `${base} · ${r.uncostedUnits} sin costo` : base;
}

/** The warning under the KPIs, or null when every sold unit had a cost. */
export function uncostedWarning(n: number): string | null {
  if (n <= 0) return null;
  return `${n} ${n === 1 ? "unidad" : "unidades"} sin costo cargado: la ganancia está incompleta`;
}

export function marginText(margin: number | null): string {
  return margin === null ? "margen —" : `margen ${margin}%`;
}
