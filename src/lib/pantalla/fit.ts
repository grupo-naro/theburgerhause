/**
 * Sizing of the counter TV's numbers (pure). Every number sits in a grid cell whose size is proportional to the font
 * size; the biggest font whose grid fits the zone wins. If even `minFont` does not fit, the zone keeps `minFont` and
 * asks for the gentle auto-scroll (never a manual scrollbar).
 */

/** Cell height in em (line + gap). */
export const CELL_H_EM = 1.4;

/** Cell width in em for numbers of `digits` digits (tabular digits ~0.62 em, plus padding and gap). */
export const cellWidthEm = (digits: number): number => 0.62 * Math.max(1, digits) + 0.9;

export type Fit = { font: number; columns: number; scroll: boolean };

/** The preparation numbers never exceed this share of the ready numbers' size ("¡Listo!" is the big one). */
export const PREPARING_RATIO = 0.7;

/** Caps the preparation zone's font bounds below the ready zone's current font (null = not measured yet). */
export function capBelowReady(bounds: { maxFont: number; minFont: number }, readyFont: number | null): { maxFont: number; minFont: number } {
  if (readyFont === null) return bounds;
  const cap = Math.floor(readyFont * PREPARING_RATIO);
  const maxFont = Math.min(bounds.maxFont, cap);
  return { maxFont, minFont: Math.min(bounds.minFont, maxFont) };
}

export function fitNumbers(o: { count: number; width: number; height: number; maxFont: number; minFont: number; digits: number }): Fit {
  const cw = cellWidthEm(o.digits);
  const columnsAt = (font: number) => Math.max(1, Math.floor(o.width / (font * cw)));
  for (let font = o.maxFont; font >= o.minFont; font -= 2) {
    const columns = columnsAt(font);
    const rows = Math.ceil(o.count / columns);
    if (o.width > 0 && columns * font * cw <= o.width && rows * font * CELL_H_EM <= o.height) return { font, columns, scroll: false };
    if (o.count === 0) return { font: o.maxFont, columns, scroll: false };
  }
  return { font: o.minFont, columns: columnsAt(o.minFont), scroll: o.count > 0 };
}
