/**
 * Cash-handling helpers of the POS. The only arithmetic of the counter screen that is not domain
 * pricing: how much change to hand back. Display only (never stored). Everything in integer cents.
 */

export type Change =
  | { kind: "none"; cents: 0 }
  | { kind: "exact"; cents: 0 }
  | { kind: "change"; cents: number }
  | { kind: "short"; cents: number };

/** Largest "Recibido" we accept ($99.999.999). */
export const MAX_RECEIVED_CENTS = 9_999_999_900;

const valid = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/** `none` when nothing (valid) was received; otherwise exact / change to give back / amount still missing. */
export function changeFor(totalCents: number, receivedCents: number | null): Change {
  if (!valid(totalCents) || !valid(receivedCents) || receivedCents === 0) return { kind: "none", cents: 0 };
  if (receivedCents === totalCents) return { kind: "exact", cents: 0 };
  if (receivedCents > totalCents) return { kind: "change", cents: receivedCents - totalCents };
  return { kind: "short", cents: totalCents - receivedCents };
}

/** Bills of the quick buttons, in cents. */
const BILLS = [100_000, 200_000, 500_000, 1_000_000, 2_000_000];

/**
 * Suggested "Recibido" amounts: the exact total, then the total rounded UP to each bill
 * ($1.000, $2.000, $5.000, $10.000, $20.000), deduplicated and ascending. Never below the total.
 */
export function quickAmounts(totalCents: number): number[] {
  if (!valid(totalCents) || totalCents === 0) return [];
  const out = new Set<number>([totalCents]);
  for (const bill of BILLS) out.add(Math.ceil(totalCents / bill) * bill);
  return [...out].filter((a) => a <= MAX_RECEIVED_CENTS).sort((a, b) => a - b);
}

/** Text typed in the "Recibido" box (whole pesos, any separators) -> cents; null when there are no digits. */
export function parsePesosInput(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return null;
  const pesos = Number(digits.slice(0, 12));
  return Math.min(pesos * 100, MAX_RECEIVED_CENTS);
}
