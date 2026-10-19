/**
 * Stock quantities live as integer MILLI-units (1 kg = 1000, 1 u = 1000): no floats anywhere.
 * Pure helpers, safe on the client (no zod, no DB).
 */

export const STOCK_UNITS = ["kg", "u", "l"] as const;
export type Unit = (typeof STOCK_UNITS)[number];
export const STOCK_KINDS = ["bebida", "materia_prima"] as const;
export type Kind = (typeof STOCK_KINDS)[number];

/** 1,000,000 kg/u/l: far above any real load, well inside int4. */
export const MAX_MILLI = 1_000_000_000;
export const MILLI_PER_UNIT = 1000;

export const QUANTITY_MESSAGES = {
  empty: "Ingresá una cantidad",
  invalid: "Cantidad inválida",
  positive: "La cantidad debe ser mayor a cero",
  whole: "Para unidades usá números enteros",
  decimals: "Usá hasta 3 decimales",
  tooBig: "La cantidad es demasiado grande",
  missingWhole: "Escribí el número completo, por ejemplo 0,5",
  missingDecimals: "Completá los decimales o borrá la coma",
} as const;

export type ParsedQuantity = { ok: true; milli: number } | { ok: false; message: string };

const NUMBER = /^(\d+)(?:[.,](\d+))?$/;

/**
 * Parses what a person types ("12,5", "12.5", "48") into milli-units. Zero and negatives are
 * rejected. There are NO thousands separators: "1.250" is 1,25 (formatQuantity never groups, so
 * what is shown can be typed back). Units (`u`) accept no separator at all, so "1.000" can never
 * silently mean 1 u.
 */
export function parseQuantity(input: string, unit: Unit): ParsedQuantity {
  const raw = typeof input === "string" ? input.trim() : "";
  if (raw === "") return { ok: false, message: QUANTITY_MESSAGES.empty };
  if (raw.startsWith("-")) return { ok: false, message: QUANTITY_MESSAGES.positive };
  if (/^[.,]\d+$/.test(raw)) return { ok: false, message: QUANTITY_MESSAGES.missingWhole };
  if (/^\d+[.,]$/.test(raw)) return { ok: false, message: QUANTITY_MESSAGES.missingDecimals };
  const m = NUMBER.exec(raw);
  if (!m) return { ok: false, message: QUANTITY_MESSAGES.invalid };
  if (unit === "u" && m[2] !== undefined) return { ok: false, message: QUANTITY_MESSAGES.whole };
  const whole = m[1];
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > 3) return { ok: false, message: QUANTITY_MESSAGES.decimals };
  if (whole.replace(/^0+/, "").length > 7) return { ok: false, message: QUANTITY_MESSAGES.tooBig };
  const milli = Number(whole) * MILLI_PER_UNIT + Number(frac.padEnd(3, "0"));
  if (milli > MAX_MILLI) return { ok: false, message: QUANTITY_MESSAGES.tooBig };
  if (milli <= 0) return { ok: false, message: QUANTITY_MESSAGES.positive };
  return { ok: true, milli };
}

/** No grouping: es-AR would print 1250 as "1.250", which the parser reads as 1,25. */
const FORMAT = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3, useGrouping: false });

/** "12,5 kg", "3 u", "0,125 l", "1250 kg" (round-trips through parseQuantity). */
export function formatQuantity(milli: number, unit: Unit): string {
  return `${FORMAT.format(milli / MILLI_PER_UNIT)} ${unit}`;
}

export type StockStatus = "ok" | "poco" | "agotado";

/** Agotado at or below zero; Poco below the item's minimum (0 = no minimum). */
export function stockStatus(quantity: number, minQty: number): StockStatus {
  if (quantity <= 0) return "agotado";
  if (minQty > 0 && quantity < minQty) return "poco";
  return "ok";
}
