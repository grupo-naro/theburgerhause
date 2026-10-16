/**
 * Parsing/formatting of the "Efectivo recibido" input. es-AR convention: the dot groups thousands
 * and the comma starts the (optional, up to two digits) centavos. "12.345", "12345" and
 * "12.345,50" are valid; "1.5" is rejected (a dot is never a decimal separator, so it would be
 * ambiguous). The result is integer centavos, never above the int4 the database stores.
 */

export const INT4_MAX = 2_147_483_647;

export type ParseFailure = "empty" | "invalid" | "negative" | "too_big";
export type ParseResult = { ok: true; cents: number } | { ok: false; reason: ParseFailure };

const AMOUNT = /^(\d{1,3}(?:\.\d{3})+|\d+)?(?:,(\d{0,2}))?$/;

export function parsePesosToCents(input: string): ParseResult {
  const text = input.trim().replace(/^\$\s*/, "");
  if (text === "") return { ok: false, reason: "empty" };
  if (text.startsWith("-")) return { ok: false, reason: "negative" };
  const m = AMOUNT.exec(text);
  if (!m || (m[1] === undefined && (m[2] === undefined || m[2] === ""))) return { ok: false, reason: "invalid" };
  const whole = (m[1] ?? "0").replaceAll(".", "").replace(/^0+(?=\d)/, "");
  if (whole.length > 10) return { ok: false, reason: "too_big" };
  const cents = Number(whole) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > INT4_MAX) return { ok: false, reason: "too_big" };
  return { ok: true, cents };
}

/** Centavos -> what the input shows: "12.345" or "1.000,50" (no currency symbol). */
export function formatPesosInput(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("cents must be a non-negative safe integer");
  const whole = Math.trunc(cents / 100);
  const rest = cents % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return rest === 0 ? grouped : `${grouped},${String(rest).padStart(2, "0")}`;
}
