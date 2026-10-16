import { formatARS } from "@/domain/money";

/** Money in integer centavos: whole pesos show no decimals, centavos show two. */
export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("cents must be a safe integer");
  if (cents % 100 === 0) return formatARS(cents);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}

export type ShortageKind = "exact" | "short" | "over";

/** Compares what was owed with what was handed over. `diff` is always >= 0 (centavos). */
export function shortageFor(expected: number, received: number): { kind: ShortageKind; diff: number } {
  if (!Number.isSafeInteger(expected) || !Number.isSafeInteger(received)) throw new Error("amounts must be safe integers");
  if (received === expected) return { kind: "exact", diff: 0 };
  return received < expected ? { kind: "short", diff: expected - received } : { kind: "over", diff: received - expected };
}

export const OVER_MESSAGE = "No puede ser más que lo que debe rendir";

export type DiffLabel = { kind: ShortageKind; text: string; tone: "ok" | "danger" };

/** The live "Diferencia" line under the amount input. */
export function diffLabel(expected: number, received: number): DiffLabel {
  const { kind, diff } = shortageFor(expected, received);
  if (kind === "exact") return { kind, text: "Exacto", tone: "ok" };
  if (kind === "short") return { kind, text: `Faltan ${formatMoney(diff)}`, tone: "danger" };
  return { kind, text: OVER_MESSAGE, tone: "danger" };
}
