/** Texts of the Medallones block (spec 2026-11-17-medallones). Pure. */

export function pattiesTotalText(n: number): string {
  return `${n.toLocaleString("es-AR")} ${n === 1 ? "medallón" : "medallones"}`;
}

const LEVELS: [1 | 2 | 3, string][] = [
  [1, "Simple"],
  [2, "Doble"],
  [3, "Triple"],
];

/** "Simple: 412 u · Doble: 301 u · Triple: 90 u", omitting empty levels. */
export function pattiesBreakdownText(byLevel: { 1: number; 2: number; 3: number }): string {
  const parts = LEVELS.filter(([k]) => byLevel[k] > 0).map(([k, label]) => `${label}: ${byLevel[k].toLocaleString("es-AR")} u`);
  return parts.length === 0 ? "Sin hamburguesas en este período" : parts.join(" · ");
}
