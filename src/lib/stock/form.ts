import type { ActionState } from "@/lib/menu/action-state";
import { parseQuantity, STOCK_UNITS, type Unit } from "./quantity";

/** Action state of the stock forms: `needsConfirm` asks the person to confirm a negative balance. */
export type StockActionState = ActionState & { needsConfirm?: boolean };

export const isUnit = (v: unknown): v is Unit => typeof v === "string" && (STOCK_UNITS as readonly string[]).includes(v);

/** A quantity that may be left empty or zero (minimum, initial stock, an annulled movement): "" and "0" mean 0. */
export function parseOptionalQuantity(raw: string, unit: Unit): { ok: true; milli: number } | { ok: false; message: string } {
  const t = raw.trim();
  if (t === "" || /^0+(?:[.,]0*)?$/.test(t)) return { ok: true, milli: 0 };
  return parseQuantity(t, unit);
}

/** Domain field names -> the names of the form fields (the UI has one "qty" input). */
export function formFieldErrors(fieldErrors: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!fieldErrors) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fieldErrors)) out[k === "milli" || k === "newMilli" ? "qty" : k] = v;
  return out;
}
